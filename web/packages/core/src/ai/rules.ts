import { checkRule, parseRuleText, ruleCategories, type RuleDefinition, type RuleProblem } from "../rules.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Regel aus normaler Sprache mit dem Modell (W6.4). Das Modell schlägt nur vor; `checkRule` verwirft, was nicht im Text
// steht oder keinen Ordner hat. Klappt das nicht, gelten die einfachen Regeln aus `parseRuleText`.

export const rulePromptVersion = 1;

const ruleActions = ["archive", "trash", "spam", "folder", "none"] as const;

export const ruleSchema: JsonSchema = {
  type: "object",
  properties: {
    from: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 3 },
    subject: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 3 },
    category: { type: "string", enum: [...ruleCategories, "none"] },
    hasAttachment: { type: "boolean" },
    action: { type: "string", enum: ruleActions },
    folder: { type: "string", maxLength: 60 },
    markRead: { type: "boolean" },
    flag: { type: "boolean" },
  },
  required: ["from", "subject", "category", "hasAttachment", "action", "folder", "markRead", "flag"],
  additionalProperties: false,
};

export function rulePrompt(text: string, folders: readonly string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du machst aus einem Wunsch des Nutzers eine Regel für sein E-Mail-Postfach. Antworte nur mit JSON:
{"from": [Absender-Adresse, Domain oder Name – wörtlich aus dem Text], "subject": [Wörter, die im Betreff stehen sollen – wörtlich], "category": "newsletter | invoice | notification | appointment | personal | work | spam_suspect | none", "hasAttachment": true/false, "action": "archive | trash | spam | folder | none", "folder": "Ordnername oder leer", "markRead": true/false, "flag": true/false}
- category nur, wenn der Nutzer eine Art Mail meint: Newsletter/Werbung → newsletter, Rechnungen → invoice, automatische Benachrichtigungen → notification, Termine/Einladungen → appointment, Betrug/Spam-Verdacht → spam_suspect.
- action: archive = ins Archiv, trash = löschen/Papierkorb, spam = in den Spam-Ordner, folder = in einen eigenen Ordner (dann "folder" setzen).
- markRead = als gelesen markieren. flag = markieren/wichtig/Fähnchen. Verneinte Wünsche („nicht markieren“) sind false.
- Eigene Ordner: ${folders.length ? folders.join(", ") : "(keine)"}. Andere Ordner gibt es nicht.
- Nichts erfinden: Absender und Betreff-Wörter müssen genau so im Text stehen. Ohne „mein“, „der“, „die“.
Beispiele:
„Mails von post@baumarkt.example archivieren“ → {"from": ["post@baumarkt.example"], "subject": [], "category": "none", "hasAttachment": false, "action": "archive", "folder": "", "markRead": false, "flag": false}
„Werbung als gelesen markieren“ → {"from": [], "subject": [], "category": "newsletter", "hasAttachment": false, "action": "none", "folder": "", "markRead": true, "flag": false}`,
    },
    { role: "user", content: text },
  ];
}

/** Antwort des Modells → Regel (noch ungeprüft). */
export function parseRuleResponse(text: string): RuleDefinition | null {
  const value = extractJson(text) as Record<string, unknown> | null;
  if (!value) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const category = typeof value.category === "string" && (ruleCategories as readonly string[]).includes(value.category) ? (value.category as RuleDefinition["category"]) : null;
  const action = typeof value.action === "string" ? value.action : "none";
  const folder = action === "folder" && typeof value.folder === "string" && value.folder.trim() ? value.folder.trim() : null;
  return {
    from: strings(value.from),
    subject: strings(value.subject),
    category,
    hasAttachment: value.hasAttachment === true,
    move: action === "archive" || action === "trash" || action === "spam" ? action : null,
    folder,
    markRead: value.markRead === true,
    flag: value.flag === true,
  };
}

export interface RuleInterpretation {
  definition: RuleDefinition;
  problems: RuleProblem[];
  origin: ResultOrigin;
  durationMs: number;
}

/** Nur Regeln, ohne Modell. */
export function interpretRuleWithRules(text: string, folders: readonly string[]): RuleInterpretation {
  return { ...checkRule(parseRuleText(text, folders), { folders, text }), origin: "rules", durationMs: 0 };
}

/**
 * Regel aus Text: zuerst die einfachen Regeln; nur wenn die keine brauchbare Regel ergeben, fragt sie das Modell (geprüft).
 * Grund (Messung 01.10.2026): Gemma 4 E2B allein erfindet gern eine „Art“ dazu („Lohnsteuer im Betreff“ → Rechnung) und war
 * schlechter als die Regeln; als Rückfall hilft es bei freien Formulierungen. `accountIds`: für die Freigabe-Prüfung
 * (der Text stammt vom Nutzer, nicht aus Mails).
 */
export async function interpretRule(
  router: AIRouter,
  text: string,
  folders: readonly string[],
  accountIds: string[],
  options: { signal?: AbortSignal; modelOnly?: boolean } = {},
): Promise<RuleInterpretation> {
  const rules = interpretRuleWithRules(text, folders);
  const blocking = (problems: RuleProblem[]) => problems.filter((p) => p !== "notInText").length;
  if (!options.modelOnly && blocking(rules.problems) === 0) return rules;
  const request: AIRequest = { task: "parseRule", messages: rulePrompt(text.slice(0, 400), folders), jsonSchema: ruleSchema, maxTokens: 200, temperature: 0 };
  const response = await router.run(request, { accountIds }, options.signal);
  const parsed = parseRuleResponse(response.text);
  if (!parsed) return { ...rules, durationMs: response.durationMs };
  const ai = checkRule(parsed, { folders, text });
  // Kann das Modell es auch nicht besser, bleibt es bei den Regeln (mit ihren Hinweisen)
  if (blocking(ai.problems) > 0 && (options.modelOnly ? blocking(rules.problems) === 0 : true)) return { ...rules, durationMs: response.durationMs };
  return { ...ai, origin: response.privacyClass, durationMs: response.durationMs };
}
