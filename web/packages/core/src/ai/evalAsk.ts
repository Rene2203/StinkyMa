// Testsatz „Frag dein Postfach“ (W8.1, geschrieben am 03.10.2026 vor der Messung). Das „Postfach“ sind die erfundenen
// Mails aus evalSet.ts (Test- und Kontrollsatz). Fragen bewusst umschrieben („umbereift“ statt „Reifenwechsel“), damit
// die Wortsuche allein nicht reicht. `sources`: eine davon muss gefunden und zitiert werden; `answer`: eines der Wörter
// muss in der Antwort stehen. Ohne `sources`: Falle – die Antwort muss „nichts gefunden“ sagen.

export interface EvalAskCase {
  id: string;
  question: string;
  sources: string[];
  answer: string[];
}

export const evalAskCases: EvalAskCase[] = [
  { id: "q01", question: "Wie viel muss ich für den Strom nachzahlen und wann?", sources: ["i01"], answer: ["84,20"] },
  { id: "q02", question: "Bekomme ich von der Hausverwaltung Geld zurück?", sources: ["i06"], answer: ["112,40"] },
  { id: "q03", question: "Wann ist mein nächster Zahnarzttermin?", sources: ["a01", "x04"], answer: ["14.10", "9:00", "8:30"] },
  { id: "q04", question: "Wer hat ein Kind bekommen?", sources: ["p08"], answer: ["Emma", "Julia"] },
  { id: "q05", question: "Wann wird mein Auto umbereift?", sources: ["a04"], answer: ["18.10", "18. Oktober"] },
  { id: "q06", question: "Welche Gebühr habe ich bei der Musikschule noch nicht bezahlt?", sources: ["i08"], answer: ["65"] },
  { id: "q07", question: "Wann hole ich den Leihwagen ab?", sources: ["x06"], answer: ["12.10", "12. Oktober"] },
  { id: "q08", question: "Wer will sein Werkzeug zurückhaben?", sources: ["p07"], answer: ["Max"] },
  { id: "q09", question: "Wie hoch ist meine Nachzahlung beim Finanzamt?", sources: ["i12"], answer: ["612"] },
  { id: "q10", question: "Was war mit den falschen Schrauben?", sources: ["w10"], answer: ["M8", "M6", "Gewinde"] },
  { id: "q11", question: "Wann fahre ich mit dem Zug nach Hamburg?", sources: ["x09"], answer: ["22.10", "7:14", "22. Oktober"] },
  { id: "q12", question: "Wann ist der Elternabend?", sources: ["a03"], answer: ["21.10", "21. Oktober"] },
  { id: "q13", question: "Was soll ich auf dem Heimweg einkaufen?", sources: ["p11"], answer: ["Milch", "Brot"] },
  // Falle: steht in keiner Mail
  { id: "q14", question: "Was hat der Vermieter zur Mieterhöhung geschrieben?", sources: [], answer: ["nichts gefunden", "keine"] },
];
