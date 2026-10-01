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

## Lauf 2 – Prompt v2 (01.10.2026)

Änderungen gegenüber v1: klare Vorrang-Regel für Phishing (Merkmale: Link + Daten/Zahlung, Drohung/Frist, Gewinne,
Absender passt nicht, Geschenkkarten), Regeln für „wer ist dran“, eigene Mails in Konversationen als „(Nutzer)“ markiert.


| Modell | Kategorie richtig | davon Regel-Rückfall | Fakten in Zusammenfassung | gültige Zusammenfassungen | „Wer ist dran“ richtig | Kategorie (Median) | Zusammenfassung (Median) | Laden |
|---|---|---|---|---|---|---|---|---|
| Gemma 4 E2B | 98,8 % | 0 | 92,3 % | 100,0 % | 60,0 % | 3,7 s | 13,1 s | 7,4 s |
| Gemma 4 E4B | 100,0 % | 0 | 96,2 % | 100,0 % | 60,0 % | 6,7 s | 27,5 s | 15,7 s |
| Qwen 3.5 2B | 87,5 % | 0 | 61,5 % | 100,0 % | 60,0 % | 9,7 s | 16,5 s | 7,5 s |
| Qwen 3.5 4B | 97,5 % | 0 | 88,5 % | 100,0 % | 90,0 % | 21,9 s | 33,9 s | 5,6 s |

Je Kategorie (richtig/gesamt):

| Modell | personal | work | newsletter | notification | invoice | appointment | spam_suspect |
|---|---|---|---|---|---|---|---|
| Gemma 4 E2B | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 | 10/10 | 9/10 |
| Gemma 4 E4B | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 | 10/10 | 10/10 |
| Qwen 3.5 2B | 12/12 | 10/12 | 12/12 | 9/12 | 12/12 | 10/10 | 5/10 |
| Qwen 3.5 4B | 12/12 | 11/12 | 11/12 | 12/12 | 12/12 | 10/10 | 10/10 |

**Gemma 4 E2B** – Fehler:
- Kategorie: s10 (spam_suspect → personal)
- Zusammenfassung: t01 / wer-ist-dran falsch; t04 / wer-ist-dran falsch; t06 / wer-ist-dran falsch; t07 fehlt: 2.000; t09 / wer-ist-dran falsch; t10 fehlt: 240

**Gemma 4 E4B** – Fehler:
- Kategorie: keine
- Zusammenfassung: t04 / wer-ist-dran falsch; t06 / wer-ist-dran falsch; t07 fehlt: 2.000; t08 / wer-ist-dran falsch; t09 / wer-ist-dran falsch

**Qwen 3.5 2B** – Fehler:
- Kategorie: w05 (work → appointment), w10 (work → invoice), x03 (notification → invoice), x08 (notification → work), x10 (notification → newsletter), s01 (spam_suspect → notification), s02 (spam_suspect → invoice), s05 (spam_suspect → invoice), s09 (spam_suspect → invoice), s10 (spam_suspect → personal)
- Zusammenfassung: t03 fehlt: 02.10.2026, Gutachter, Kellerabteil / wer-ist-dran falsch; t04 fehlt: Folie 7, Hansen; t06 fehlt: 11.11. / wer-ist-dran falsch; t07 fehlt: 2.000; t08 / wer-ist-dran falsch; t09 fehlt: 1.140; t10 fehlt: 240, Gartenpflege / wer-ist-dran falsch

**Qwen 3.5 4B** – Fehler:
- Kategorie: w05 (work → appointment), n10 (newsletter → notification)
- Zusammenfassung: t03 fehlt: Gutachter, Kellerabteil; t06 / wer-ist-dran falsch; t07 fehlt: M8

### Kontrollsatz (28 Mails, nie zum Feintuning benutzt)

Prüft, ob v2 nur auf den eigenen Testsatz passt. Kategorie richtig (Phishing erkannt):

| Modell | v1 | v2 |
|---|---|---|
| Gemma 4 E2B | 85,7 % (1/4) | 92,9 % (3/4) |
| Gemma 4 E4B | 96,4 % (3/4) | 100,0 % (4/4) |
| Qwen 3.5 2B | 78,6 % (1/4) | 82,1 % (2/4) |
| Qwen 3.5 4B | 92,9 % (2/4) | 96,4 % (3/4) |

## Aktionen erkennen (W6.1, 01.10.2026)

35 Fälle mit 43 erwarteten Angaben (Termine, Fristen, Zahlungen, To-dos), plus Mails ohne Aktion. Gemessen auf 4 CPU-Kernen,
`eval-models.ts --actions`. „Angaben gefunden“: Datum/Uhrzeit/Betrag stimmen. „Unnötig“: Aktion in einer Mail ohne Aktion.

| Verfahren | Angaben gefunden | unnötige Aktionen | Regel-Rückfall | Zeit (Median) |
|---|---|---|---|---|
| Regeln (ohne KI) | 93,0 % (von 43) | 0 | 0 | 0,0 s |
| Gemma 4 E2B | 97,7 % (von 43) | 4 | 0 | 7,8 s |
| Gemma 4 E4B | 93,0 % (von 43) | 3 | 0 | 15,4 s |

- Beide Gemma-Modelle setzen bei „31. Oktober“ das falsche Jahr (2027) – Kandidat für die Feinabstimmung (Bezugsdatum im Prompt
  deutlicher, Jahr bei fehlender Angabe per Regel ergänzen).
- E4B ist hier **nicht** besser als E2B: verschiebt einmal einen Termin um einen Tag und lässt einmal das Datum weg, bei doppelter
  Zeit. Für Aktionen bleibt E2B die Wahl; die Regeln laufen ohnehin sofort und die KI verfeinert im Hintergrund.
- Ehrlich: Die Regeln wurden an diesem Satz entwickelt; ihre 93 % sind deshalb eher optimistisch.

## Ergebnis und Entscheidung

- **Standard: Gemma 4 E2B.** Mit v2 98,8 % (Testsatz) bzw. 92,9 % (Kontrollsatz) richtig eingeordnet – Ziel ≥ 90 % erreicht –,
  schnellstes Modell (~3,7 s je Mail, ~13 s je Zusammenfassung auf 4 CPU-Kernen), versteht zusätzlich Bilder und Sprache.
  Laut Entscheidungsregel („Gemma wird Standard, wenn es beim deutschen Text nicht deutlich schlechter ist“) eindeutig:
  Gemma 4 E2B ist in diesem Test sogar besser als Qwen 3.5 2B.
- **Für stärkere Rechner: Gemma 4 E4B** – fehlerfrei in beiden Sätzen, aber etwa doppelt so langsam.
- **Qwen 3.5 2B** ist auf dieser CPU langsamer *und* ungenauer (Phishing, Fakten in Zusammenfassungen). **Qwen 3.5 4B** ist
  gut und bei „wer ist dran“ am besten (90 %), auf schwacher Hardware aber mit ~22 s je Mail am langsamsten.
- Die Phishing-Verbesserung durch v2 trägt auch im Kontrollsatz (Gemma E2B 1/4 → 3/4), ist also keine reine Überanpassung.

**Offen:** „Wer ist dran“ bleibt bei den Gemma-Modellen bei 60 % (v2 half nur Qwen 4B). Fakten in Zusammenfassungen 92 %
(Ziel Extraktion ≥ 95 %; fehlende Fakten betreffen meist Details bereits erledigter Vorgänge). Nächster Schritt: Prompt für
Zusammenfassungen gezielt verbessern (v3) und erneut messen. Messung auf dem N97 und mit Grafikkarte steht aus.
