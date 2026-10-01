# KI-Messung: Gemma 4 vs. Qwen 3.5

Messlauf mit `web/packages/core/scripts/eval-models.ts` gegen den deutschen Testsatz (`packages/core/src/ai/evalSet.ts`):
80 erfundene Mails (7 Kategorien, Grenzfälle erlaubt), 10 Konversationen mit Fakten, die in der Zusammenfassung stehen
müssen, und „wer ist dran“. Alle Modelle in 4-Bit (Q4_K_M, GGUF), llama.cpp über node-llama-cpp 3.22.1, Temperatur 0,
JSON per Grammatik erzwungen, „Nachdenken“ aus.

**Messrechner:** Cloud-Container, 4 Kerne (Intel Xeon 2,8 GHz), 16 GB RAM, **nur CPU** – grob in der Liga eines
Low-End-PCs bzw. etwas schneller als ein N97. Zeiten sind Richtwerte (eine Messung, Container geteilt).

Ziele laut Spezifikation 5.7: Kategorie ≥ 90 %, Extraktion ≥ 95 %.

## Lauf 1 – Prompt v1 (01.10.2026)


| Modell | Kategorie richtig | davon Regel-Rückfall | Fakten in Zusammenfassung | gültige Zusammenfassungen | „Wer ist dran“ richtig | Kategorie (Median) | Zusammenfassung (Median) | Laden |
|---|---|---|---|---|---|---|---|---|
| Gemma 4 E2B | 88,8 % | 0 | 100,0 % | 100,0 % | 70,0 % | 3,5 s | 12,3 s | 9,8 s |
| Gemma 4 E4B | 97,5 % | 0 | 92,3 % | 100,0 % | 60,0 % | 6,2 s | 21,7 s | 11,9 s |
| Qwen 3.5 2B | 85,0 % | 0 | 80,8 % | 100,0 % | 70,0 % | 5,9 s | 12,9 s | 3,7 s |
| Qwen 3.5 4B | 96,3 % | 0 | 92,3 % | 100,0 % | 60,0 % | 14,3 s | 26,9 s | 12,1 s |

Je Kategorie (richtig/gesamt):

| Modell | personal | work | newsletter | notification | invoice | appointment | spam_suspect |
|---|---|---|---|---|---|---|---|
| Gemma 4 E2B | 12/12 | 12/12 | 12/12 | 11/12 | 12/12 | 9/10 | 3/10 |
| Gemma 4 E4B | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 | 10/10 | 8/10 |
| Qwen 3.5 2B | 12/12 | 10/12 | 12/12 | 9/12 | 12/12 | 10/10 | 3/10 |
| Qwen 3.5 4B | 11/12 | 12/12 | 12/12 | 12/12 | 12/12 | 10/10 | 8/10 |

**Gemma 4 E2B** – Fehler:
- Kategorie: x08 (notification → work), a09 (appointment → notification), s01 (spam_suspect → notification), s02 (spam_suspect → notification), s04 (spam_suspect → notification), s05 (spam_suspect → invoice), s06 (spam_suspect → notification), s09 (spam_suspect → invoice), s10 (spam_suspect → personal)
- Zusammenfassung: t02 / wer-ist-dran falsch; t06 / wer-ist-dran falsch; t08 / wer-ist-dran falsch

**Gemma 4 E4B** – Fehler:
- Kategorie: s05 (spam_suspect → invoice), s10 (spam_suspect → work)
- Zusammenfassung: t01 / wer-ist-dran falsch; t06 fehlt: 20.10. / wer-ist-dran falsch; t07 fehlt: 2.000; t08 / wer-ist-dran falsch; t09 / wer-ist-dran falsch

**Qwen 3.5 2B** – Fehler:
- Kategorie: w04 (work → invoice), w05 (work → appointment), x03 (notification → invoice), x08 (notification → work), x10 (notification → work), s01 (spam_suspect → notification), s02 (spam_suspect → invoice), s04 (spam_suspect → notification), s05 (spam_suspect → invoice), s06 (spam_suspect → notification), s09 (spam_suspect → invoice), s10 (spam_suspect → personal)
- Zusammenfassung: t03 fehlt: 02.10.2026, Kellerabteil / wer-ist-dran falsch; t05 fehlt: Wasserkocher; t07 fehlt: 2.000; t08 / wer-ist-dran falsch; t09 fehlt: 1.140; t10 / wer-ist-dran falsch

**Qwen 3.5 4B** – Fehler:
- Kategorie: p07 (personal → work), s06 (spam_suspect → notification), s10 (spam_suspect → work)
- Zusammenfassung: t02 / wer-ist-dran falsch; t03 fehlt: Gutachter, Kellerabteil; t05 / wer-ist-dran falsch; t06 / wer-ist-dran falsch; t10 / wer-ist-dran falsch

Gesamtdauer je Modell (90 Aufgaben): Gemma 4 E2B 7,4 min · Gemma 4 E4B 14,5 min · Qwen 3.5 2B 10,2 min · Qwen 3.5 4B 23,8 min.

**Beobachtungen v1:** Alle Modelle liefern immer gültiges JSON (Grammatik) – kein einziger Regel-Rückfall. Gemma 4 E2B ist
das schnellste Modell und behält Fakten am zuverlässigsten (100 %), erkennt aber Phishing schlecht (3/10). Die 4B-Klasse
erkennt Phishing deutlich besser (8/10), braucht aber 2–4× so lange. Qwen 3.5 2B ist auf diesem Rechner trotz kleinerer
Datei langsamer als Gemma 4 E2B und lässt öfter Fakten weg. „Wer ist dran“ ist bei allen schwach (60–70 %).
