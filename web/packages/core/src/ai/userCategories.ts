import type { Message } from "../models.js";
import type { UserCategory } from "../userCategories.js";
import { mailForModel } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Eigene Kategorien: ein eigener, kurzer Schritt nach der festen Einordnung. Deren Prompt bleibt unverändert (gemessen);
// hier entscheidet das Modell nur „welche eigene Kategorie passt – oder keine“.

export const userCategoryPromptVersion = 2;
const none = "keine";

export function userCategorySchema(categories: readonly Pick<UserCategory, "name">[]): JsonSchema {
  return {
    type: "object",
    properties: { kategorie: { type: "string", enum: [...categories.map((c) => c.name), none] } },
    required: ["kategorie"],
    additionalProperties: false,
  };
}

// v1 (erste Messung): kleine Modelle ordneten jede zweite Mail ohne passende Kategorie trotzdem einer zu (ähnliches Thema
// reichte). v2: „keine“ ist der Normalfall, eine Kategorie nur bei direktem Bezug zur Beschreibung.
export function userCategoryPrompt(mail: string, categories: readonly Pick<UserCategory, "name" | "description">[], version: 1 | 2 = 2): AIMessage[] {
  const list = categories.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`).join("\n");
  const rules =
    version === 1
      ? `Wähle die Kategorie, deren Beschreibung zum Absender oder zum Thema der E-Mail passt. Passt keine, antworte "${none}".`
      : `Die meisten E-Mails gehören zu keiner dieser Kategorien – dann antworte "${none}".
Wähle eine Kategorie nur, wenn die E-Mail direkt von dem handelt, was in ihrer Beschreibung steht (genannte Personen, Firmen, Vereine, Dinge oder Themen). Ein nur ähnliches oder verwandtes Thema reicht nicht.`;
  return [
    {
      role: "system",
      content: `Der Nutzer hat eigene Kategorien für seine E-Mails angelegt. Prüfe, ob die E-Mail zu einer davon gehört.
Kategorien:
${list}
${rules}
Antworte nur mit JSON: {"kategorie": "..."}`,
    },
    { role: "user", content: mail },
  ];
}

const confirmSchema: JsonSchema = {
  type: "object",
  properties: { passt: { type: "boolean" } },
  required: ["passt"],
  additionalProperties: false,
};

/** v3: Rückfrage nur bei einem Treffer – kleine Modelle wählen in der Auswahl leicht „irgendwas Ähnliches“. */
export function userCategoryConfirmPrompt(mail: string, category: Pick<UserCategory, "name" | "description">): AIMessage[] {
  return [
    {
      role: "system",
      content: `Der Nutzer sammelt in der Kategorie "${category.name}" E-Mails zu: ${category.description || category.name}.
Gehört diese E-Mail in die Kategorie? Nur ja, wenn sie direkt davon handelt – ein ähnliches Thema, Werbung einer anderen Firma oder eine private Nachricht ohne diesen Bezug gehört nicht hinein.
Antworte nur mit JSON: {"passt": true} oder {"passt": false}`,
    },
    { role: "user", content: mail },
  ];
}

/** Antwort lesen: ID der Kategorie, `"none"` für „keine“, `null` bei unbrauchbarer Antwort. */
export function parseUserCategory(text: string, categories: readonly Pick<UserCategory, "id" | "name">[]): string | "none" | null {
  const value = extractJson(text) as { kategorie?: unknown } | null;
  if (!value || typeof value.kategorie !== "string") return null;
  const answer = value.kategorie.trim().toLowerCase();
  if (answer === none || answer === "none" || answer === "") return "none";
  return categories.find((c) => c.name.toLowerCase() === answer)?.id ?? null;
}

export interface UserCategoryResult {
  /** ID der Kategorie oder `null` (keine passt) */
  categoryId: string | null;
  origin: ResultOrigin;
  durationMs: number;
}

/** Welche eigene Kategorie passt? Ohne brauchbare Antwort nach zwei Versuchen: keine. */
export async function classifyUserCategory(
  router: AIRouter,
  message: Message,
  categories: readonly UserCategory[],
  options: { signal?: AbortSignal; /** nur für Vergleichsmessungen */ promptVersion?: 1 | 2 | 3 } = {},
): Promise<UserCategoryResult> {
  const version = options.promptVersion ?? 2;
  const mail = mailForModel(message, 1200);
  const request: AIRequest = {
    task: "userCategory",
    messages: userCategoryPrompt(mail, categories, version === 1 ? 1 : 2),
    jsonSchema: userCategorySchema(categories),
    maxTokens: 30,
    temperature: 0,
  };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseUserCategory(response.text, categories);
    if (parsed && parsed !== "none" && version === 3) {
      const category = categories.find((c) => c.id === parsed);
      if (category) {
        const check = await router.run({ task: "userCategory", messages: userCategoryConfirmPrompt(mail, category), jsonSchema: confirmSchema, maxTokens: 15, temperature: 0 }, { accountIds: [message.accountId] }, options.signal);
        durationMs += check.durationMs;
        const value = extractJson(check.text) as { passt?: unknown } | null;
        if (value?.passt === false) return { categoryId: null, origin: response.privacyClass, durationMs };
      }
    }
    if (parsed) return { categoryId: parsed === "none" ? null : parsed, origin: response.privacyClass, durationMs };
  }
  return { categoryId: null, origin: "rules", durationMs };
}
