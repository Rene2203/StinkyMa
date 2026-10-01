import { AIBlockedError, AINotConfiguredError, type AIProvider, type AIRequest, type AIResponse, type AITask, type PrivacyClass } from "./types.js";

/**
 * Freigaben (5.0): On-Device ist immer erlaubt. „Eigener Server“ und „Cloud“ nur, wenn der Nutzer sie für
 * genau dieses Konto und genau diese Aufgabe freigegeben hat.
 */
export interface AIGrant {
  accountId: string;
  task: AITask;
  privacyClass: Exclude<PrivacyClass, "onDevice">;
}

export interface AIPolicy {
  isAllowed(accountId: string, task: AITask, privacyClass: PrivacyClass): boolean;
}

export class GrantPolicy implements AIPolicy {
  readonly #grants: Set<string>;

  constructor(grants: readonly AIGrant[] = []) {
    this.#grants = new Set(grants.map((g) => `${g.accountId}\n${g.task}\n${g.privacyClass}`));
  }

  isAllowed(accountId: string, task: AITask, privacyClass: PrivacyClass): boolean {
    if (privacyClass === "onDevice") return true;
    return this.#grants.has(`${accountId}\n${task}\n${privacyClass}`);
  }
}

/**
 * Zwischenschritt für ausgehende und eingehende Texte (5.6). Anfangs ohne Funktion; später Pseudonymisierung
 * für „Eigener Server“ und „Cloud“. Gilt nie für On-Device.
 */
export interface PrivacyGuard {
  outgoing(request: AIRequest): AIRequest;
  incoming(response: AIResponse): AIResponse;
}

export const passThroughGuard: PrivacyGuard = {
  outgoing: (request) => request,
  incoming: (response) => response,
};

/** Protokoll jeder Übertragung außerhalb des Geräts (Datenschutz-Dashboard, 7.6). */
export interface AITransferLog {
  record(entry: { at: string; providerId: string; privacyClass: PrivacyClass; task: AITask; accountIds: string[]; characters: number }): void;
}

/**
 * Zentrale Stelle für jeden KI-Aufruf (5.1): wählt den Anbieter der Aufgabe, prüft die Freigabe für **alle**
 * beteiligten Konten und blockiert sonst – kein stilles Umleiten, kein Ausweichen auf Server oder Cloud.
 */
export class AIRouter {
  constructor(
    private readonly options: {
      /** Anbieter je Aufgabe (Nutzerwahl); `null` = für diese Aufgabe nichts eingerichtet. */
      providerFor: (task: AITask) => AIProvider | null;
      policy: AIPolicy;
      guard?: PrivacyGuard;
      transferLog?: AITransferLog;
      now?: () => Date;
    },
  ) {}

  /** Welcher Anbieter würde die Aufgabe ausführen (für Anzeige „berechnet auf …“)? */
  providerFor(task: AITask): AIProvider | null {
    return this.options.providerFor(task);
  }

  async run(request: AIRequest, context: { accountIds: string[] }, signal?: AbortSignal): Promise<AIResponse> {
    const provider = this.options.providerFor(request.task);
    if (!provider) {
      throw new AINotConfiguredError("Für diese Aufgabe ist noch kein KI-Modell eingerichtet.");
    }
    if (context.accountIds.length === 0) throw new AIBlockedError("Ohne Konto keine Freigabe-Prüfung möglich.");
    for (const accountId of new Set(context.accountIds)) {
      if (!this.options.policy.isAllowed(accountId, request.task, provider.privacyClass)) {
        throw new AIBlockedError(
          `„${provider.displayName}“ ist für diese Aufgabe nicht freigegeben – Mails dieses Kontos verlassen das Gerät nicht.`,
        );
      }
    }
    if (provider.privacyClass === "onDevice") return provider.generate(request, signal);

    const guard = this.options.guard ?? passThroughGuard;
    const outgoing = guard.outgoing(request);
    this.options.transferLog?.record({
      at: (this.options.now?.() ?? new Date()).toISOString(),
      providerId: provider.id,
      privacyClass: provider.privacyClass,
      task: request.task,
      accountIds: [...new Set(context.accountIds)],
      characters: outgoing.messages.reduce((sum, m) => sum + m.content.length, 0),
    });
    return guard.incoming(await provider.generate(outgoing, signal));
  }
}
