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

## Regeln in eigenen Worten (W6.4, 01.10.2026)

24 Testsätze (daran wurden die einfachen Regeln entwickelt) und 12 Kontrollsätze (vorher geschrieben, nie zum Verbessern
benutzt), z. B. „Rechnungen von stadtwerke.example in Steuer 2026“. Richtig = alle Felder der Regel stimmen.
`eval-models.ts --rules`, 4 CPU-Kerne.

| Verfahren | Testsatz | Kontrollsatz | Modell gefragt | Zeit je Modell-Aufruf |
|---|---|---|---|---|
| Regeln (ohne KI) | 24/24 | 10/12 | – | 0 s |
| Gemma 4 E2B, nur Modell | 18/24 | 6/12 | 36 | 5,3 s |
| **Gemma 4 E2B, Regeln zuerst** (Standard) | **24/24** | **11/12** | 1 | 8,4 s |
| Gemma 4 E4B, nur Modell | 23/24 | **12/12** | 36 | 10,1 s |
| Gemma 4 E4B, Regeln zuerst | 24/24 | 11/12 | 1 | 16,2 s |
| Qwen 3.5 2B, nur Modell | 17/24 | 8/12 | 36 (15 unbrauchbar) | 9,8 s |
| Qwen 3.5 2B, Regeln zuerst | 24/24 | 10/12 | 1 | 9,9 s |

- Das Modell allein **erfindet eine „Art“ dazu** („Lohnsteuer im Betreff“ → Rechnung, „Chefin“ → Arbeit, „Oma Hilde“ →
  persönlich) und setzt bei „markieren“ manchmal zusätzlich „gelesen“. Für ein ~3B-Modell ist die Aufgabe offenbar zu offen.
- Deshalb entscheidet die App: **zuerst die Regeln, das Modell nur, wenn die nichts Brauchbares ergeben** (keine Bedingung,
  keine Aktion, unbekannter Ordner). Im Kontrollsatz rettet es so „Spam-Verdacht direkt in den Junk-Ordner“.
- **Gemma 4 E4B versteht die Aufgabe dagegen sehr gut** (Kontrollsatz fehlerfrei, auch die Verneinung) – bei doppelter Zeit.
  Kandidat für die Feinabstimmung: auf stärkeren Rechnern mit E4B „Modell zuerst“ (Regeln als Prüfung), sonst wie bisher.
- Qwen 3.5 2B liefert ohne Regeln oft gar nichts Brauchbares (15 von 36).
- Offen: Verneinung („nicht markieren, nur archivieren“) – Regeln und E2B markieren trotzdem. Im Formular sichtbar.

## Antwortvorschläge (W6.5, 01.10.2026)

12 Mails aus dem Testsatz, auf die man antworten würde (8 du, 4 Sie). `eval-models.ts --replies`, 4 CPU-Kerne. Gezählt wird,
was die Prüfung übrig lässt (keine Platzhalter, richtige Anrede, keine erfundenen Zahlen); die Qualität lässt sich nur
lesend beurteilen – alle Vorschläge stehen in der Ausgabe des Messlaufs.

| Modell / Prompt | ≥ 2 Vorschläge | du/Sie richtig | Zeit (Median) |
|---|---|---|---|
| Gemma 4 E2B, v1 (freie Liste) | 2/12 | 11/12 | 5,3 s |
| Gemma 4 E4B, v1 | 12/12 | 11/12 | 27,3 s |
| **Gemma 4 E2B, v2 (drei feste Plätze)** | **12/12** | **12/12** | **7,0 s** |

- v1 ließ das Modell die Anzahl wählen – E2B hörte meist nach einem Vorschlag auf. v2 gibt drei Plätze vor (zusagen/danken,
  absagen/später, nachfragen); unpassende bleiben leer.
- du/Sie: v1 siezte „Sarah“ (Mail ohne Anrede, nur mit Vornamen unterschrieben) – jetzt zählt die Unterschrift mit.
- Gelesen: meist natürlich und brauchbar. Schwächen von E2B: gelegentlich holprig („gerne übernehme die Anfragen“), manche
  Rückfrage wenig sinnvoll („wann haben Sie das Angebot fertiggestellt?“ auf ein fertiges Angebot). Deshalb nur Vorschläge,
  die im Editor geändert werden können – gesendet wird nie automatisch.
- Ausreißer bei der Zeit (bis 35 s) – bei drei Plätzen schreibt das Modell manchmal lange; Kandidat für die Feinabstimmung
  (maxLength je Platz kürzer).

## Feinabstimmung Gemma 4 E2B / E4B (01./02.10.2026)

4 CPU-Kerne wie oben. Ziel: die offenen Punkte der bisherigen Messungen – „wer ist dran“, Fakten, Jahr ohne Jahreszahl,
Wochentage, unnötige Aktionen.

### Zusammenfassungen (`eval-models.ts --summaries [--summary-v2]`)

Neu: Kontrollsatz mit 10 Konversationen (`evalHoldoutThreads`), vor der Feinabstimmung geschrieben – u. a. Fälle, in denen
die letzte Mail von jemand anderem stammt, der Nutzer aber trotzdem wartet („ich melde mich bis Freitag“).

| Fassung | Modell | „Wer ist dran“ Testsatz | Kontrollsatz | zusammen | Fakten (Test/Kontrolle) | Zeit (Median) |
|---|---|---|---|---|---|---|
| v2 (bisher) | E2B | 60 % | 90 % | 15/20 | 92,3 % / 100 % | 11,8 s |
| v2 (bisher) | E4B | 60 % | 80 % | 14/20 | 96,2 % / 100 % | 21,1 s |
| v3 | E2B | 80 % | 50 % | 13/20 | 100 % / 100 % | 12,6 s |
| v3 | E4B | 90 % | 80 % | 17/20 | 100 % / 100 % | 24,8 s |
| **v4 (neu, Standard)** | **E2B** | **90 %** | **90 %** | **18/20** | 96,2 % / 100 % | 13,2 s |
| **v4 (neu, Standard)** | **E4B** | **90 %** | **90 %** | **18/20** | 96,2 % / 100 % | 26,6 s |

- **v3**: zwei Ja/Nein-Fragen an das Modell („muss der Nutzer handeln?“, „wartet er?“). E4B profitierte, E2B nicht – es
  verneinte beides gerade dann, wenn der Nutzer zuletzt etwas gefragt hatte.
- **v4**: Das Modell beurteilt nur noch die **letzte Mail** (fragt/bittet sie? kündigt sie eine Meldung an?). Wer dann dran
  ist, folgt im Code daraus, wer sie geschrieben hat. Dazu im Prompt: „Übernimm alle Beträge, Mengen, Daten … auch bei
  Erledigtem“.
- Verbleibende Fehler: „Anna, dann bitte nur noch Folie 7 und 9 anschauen“ (Bitte nicht erkannt), „Ich melde mich bis
  Freitag“ von E2B als Frage gewertet, Elternbrief mit Frist von E4B übersehen.
- **Ehrlich:** Die Fehler von v3 im Kontrollsatz flossen in den Entwurf von v4 ein – der Kontrollsatz ist damit nicht mehr
  ganz unberührt. Die Verbesserung trägt aber in beiden Sätzen gleich (90 %).

### Aktionen (`eval-models.ts --actions`)

Neu: 14 Fälle mit relativen Angaben („am Dienstag um 9:30“, „bis Freitag“, „morgen“, „übermorgen“, Öffnungszeiten als
Falle), davon 6 als Kontrollfälle. Insgesamt 60 erwartete Angaben (vorher 43).

| Verfahren | Angaben gefunden | unnötige Aktionen | Zeit (Median) |
|---|---|---|---|
| Regeln vorher (ohne Wochentage) | – (relative Fälle: 0 von 13) | 0 | 0 s |
| **Regeln jetzt** | **95,0 %** | 0 | 0 s |
| E2B mit Kalender im Prompt (Zwischenstand) | 90,0 % | 9 | 6,8 s |
| E4B mit Kalender im Prompt (Zwischenstand) | 98,3 % | 6 | 12,1 s |
| **E2B mit Gegenprobe (Standard)** | **100,0 %** | 3 | 7,2 s |
| **E4B mit Gegenprobe** | 98,3 % | 3 | 11,9 s |

- **Jahr ohne Jahreszahl** („31. Oktober“): setzt jetzt der Code (nächstes passendes ab Maildatum) – beide Modelle hatten 2027 geraten.
- **Wochentage, „morgen“, „übermorgen“** in den Regeln (nicht bei „Montag bis Freitag“, „immer dienstags“, Öffnungszeiten).
- Ein **Kalender der nächsten 7 Tage im Prompt** verwirrte E2B (kopierte das erste Datum, sogar bei „17.10.“) – wieder
  entfernt. Stattdessen **Gegenprobe**: Belegt der Satz in der Mail ein anderes Datum (fest oder relativ), gilt das; Werbung und
  Öffnungszeiten aus dem Modell werden verworfen.
- „Angebot“ allein gilt nicht mehr als Werbung („das Angebot für Hansen muss spätestens am Donnerstag raus“).
- Ehrlich: Ein Kontrollfall deckte einen Fehler auf („Schalter 3. Bitte“ galt als Datum) – behoben. „Freitagnachmittag“
  (zusammengesetzt) erkennen die Regeln nicht.

### Antwortvorschläge, Regeln, Einordnung

- **Antwortvorschläge** (unverändert, jetzt auch E4B gemessen): beide 12/12 mit ≥ 2 Vorschlägen und richtiger Anrede;
  E2B 5,1 s, E4B 16,1 s (Median). Kein Handlungsbedarf.
- **Regeln in eigenen Worten**: E4B „Modell zuerst“ bringt nichts – 35/36 wie „Regeln zuerst“, aber 36 statt 1 Modellaufruf.
  Bleibt bei „Regeln zuerst“ für alle Modelle.
- **Einordnung**: unverändert (98,8 % / 92,9 % bei E2B). Ohne echte Fehlbeispiele aus dem Postfach des Nutzers würde weiteres
  Feilen nur auf den Testsatz passen.

## Verträge & Abos (W7.1, 02.10.2026)

`eval-models.ts --subscriptions`, 4 CPU-Kerne. Drei Sätze, alle erfunden, Mails vom 30.09.2026:
- **Testsatz** (22 Mails: 16 Abos/Verträge – Probe-Abos, Mindestlaufzeit, Kündigungsfrist, Preisänderung, Kündigungsbestätigung,
  Englisch – und 6 Fallen: Werbung „jetzt abonnieren“, Einzelkauf, kostenloser Newsletter, Phishing, private Mail, Bahnticket).
- **Kontrollsatz** (10 Mails, vor der Erkennung geschrieben).
- **Kontrollsatz 2** (12 Mails, absichtlich unordentlich, geschrieben *nachdem* die Regeln am Testsatz 100 % erreichten:
  Englisch, „€8.99“, „ends tomorrow“, Rechnungen statt Bestätigungen, Fallen wie „bis zu 300 € sparen“ oder „kannst du mir die
  9,99 € fürs Abo überweisen?“).

Gezählt: Abo erkannt (ja/nein), Fehlalarme, Angaben (Art, Anbieter, Betrag, Zahlweise, Probe-Ende, letzter Kündigungstag ±1 Tag,
gekündigt). Den Kündigungstag rechnet immer der Code (Laufzeitende bzw. Verlängerung minus Frist).

| Verfahren | Testsatz | Kontrollsatz | Kontrollsatz 2 | Zeit (Median) |
|---|---|---|---|---|
| Regeln (ohne KI) | 16/16 · 100 % · 0 Fehlalarme | 7/7 · 100 % · 0 | 5/9 · 43,9 % · 1 | 0 s |
| Gemma 4 E2B | 16/16 · 100 % · 0 | 7/7 · 100 % · 1 | 8/9 · 80,5 % · 1 | 13,7 s |
| Gemma 4 E4B | 16/16 · 100 % · 0 | 7/7 · 100 % · 1 | 9/9 · 87,8 % · 1 | 23,1 s |

- **Die 100 % der Regeln sind geschönt**: Testsatz, Kontrollsatz und Regeln stammen aus einer Hand. Kontrollsatz 2 zeigt die
  Grenzen (44 %). Genau dort holt das Modell viel heraus – deshalb: Regeln sofort, Modell im Hintergrund.
- Beide Modelle hielten **private Mails über Abos** für Abos („ich hab mein Tonwelle-Abo gekündigt“, „überweis mir die 9,99 €
  fürs Abo“). In der App werden als „Persönlich“ eingeordnete Mails deshalb nicht nach Abos durchsucht (im Messlauf nicht
  abbildbar, weil dort keine Einordnung vorliegt).
- Danach allgemeine Korrekturen: Betragsprüfung in Cent („€8.99“ wurde fälschlich verworfen), „tomorrow“/„today“, Versicherung
  auch am Absendernamen erkennen, genauere Art der Regeln geht vor. **Ehrlich:** gesehen am Kontrollsatz 2 – der ist damit nicht
  mehr unberührt. Nachmessung danach: Regeln Kontrollsatz 2 51,2 %, **Gemma 4 E2B 90,2 %** (8/9, Testsatz und Kontrollsatz
  unverändert 100 %, 13,3 s je Mail). Übrig bei E2B: eine sehr knappe Abo-Mail nicht erkannt (sx05) und die beiden privaten
  Mails (sh09, sx09 – in der App über die Einordnung „Persönlich“ abgefangen). E4B wurde nicht nachgemessen.
- Nach der Nachbesserung (Werbefilter für KI-Funde, englische Beträge in den Regeln, PDF-Text): Gemma 4 E2B unverändert
  100 % / 100 % / 90,2 %, Regeln unverändert – der Werbefilter kostet in den Testsätzen keinen echten Fund.

## Eigene Kategorien (02.10.2026)

Aufgabe: Passt eine Mail zu einer der eigenen Kategorien des Nutzers – oder zu keiner? Eigener kurzer Schritt nach der
festen Einordnung (deren Prompt bleibt unverändert). Testsatz: 3 Beispiel-Kategorien (Gaming, Verein, Schule), 30 Mails,
davon 10 ohne passende Kategorie mit Fallen (Sportgeschäft-Werbung, Kinderarzt, Bundesliga-Tickets, Streamflix-Doku über
Videospiele, Oma). Kontrollsatz (geschrieben nach Lauf v1, **vor** v2/v3): andere Kategorien (Auto, Reisen, Garten),
20 Mails, 8 ohne Kategorie. Gemessen auf 4 CPU-Kernen.

| Modell | Variante | Testsatz richtig | fälschlich zugeordnet | Kontrollsatz richtig | fälschlich zugeordnet | Zeit (Median) |
|---|---|---|---|---|---|---|
| Gemma 4 E2B | v1 | 25/30 | 5/10 | 19/20 | 1/8 | 2,4 s |
| Gemma 4 E2B | v2 | 25/30 | 5/10 | 19/20 | 1/8 | 2,3 s |
| Gemma 4 E2B | **v3** | **30/30** | **0/10** | **20/20** | **0/8** | 8,1 s |
| Gemma 4 E4B | v1 | 28/30 | 2/10 | 20/20 | 0/8 | 4,1 s |
| Gemma 4 E4B | **v2** | **29/30** | **1/10** | **20/20** | **0/8** | 4,0 s |
| Gemma 4 E4B | v3 | 28/30 (1 übersehen) | 1/10 | 20/20 | 0/8 | 15,4 s |

- Alle Varianten erkennen die Mails, die in eine Kategorie gehören (außer E4B v3: 1 übersehen). Das Problem waren
  Mails ohne passende Kategorie: E2B ordnete jede zweite trotzdem zu („ähnliches Thema“).
- v2 (Anweisung „keine ist der Normalfall, nur bei direktem Bezug“) hilft E2B nicht, E4B ein wenig.
- v3 = v2 plus **Rückfrage nur bei einem Treffer** („gehört diese Mail wirklich in ‚X‘?“). Bei E2B verschwinden alle
  Fehlzuordnungen in beiden Sätzen, ohne dass etwas übersehen wird – kostet aber eine zweite Anfrage je Treffer.
- **Entscheidung:** E2B (Standard) mit v3, E4B mit v2. Der KI-Durchgang läuft im Hintergrund (neueste 300 Mails, dann
  nur neue). **Ehrlich:** Die Sätze sind klein und von derselben Hand; v3 entstand nach Lauf v1 am Testsatz, der
  Kontrollsatz war für v2/v3 neu. Echte Postfächer sind ungeprüft.

## Belegordner (W7.2, 02.10.2026)

Aufgabe: Ist die Mail ein Beleg, und was steht drin (Händler, Datum, Brutto, Netto/MwSt., Rechnungsnummer, Frist,
Kategorie)? Testsatz 20 Mails (6 Fallen: Werbung, Angebot, Versandinfo, Phishing-„Rechnung“, private Schulden,
Kontoauszug), Kontrollsatz 12 (Englisch, Beträge nur im PDF, Storno, Kostenvoranschlag), **Kontrollsatz 2** 10
(unordentlich: PDF-Tabellen, Beträge ohne €, ISO-Daten, „Subtotal/Tax/Total“; geschrieben nach dem Feinschliff der
Regeln und danach nicht mehr zum Anpassen genutzt). Angaben richtig = alle erwarteten Felder; Kategorie getrennt.

| Verfahren | Testsatz | Kontrollsatz | Kontrollsatz 2 | Fehlalarme (KS 2) | Zeit (Median) |
|---|---|---|---|---|---|
| Regeln (ohne KI) | 14/14 · 100 % | 8/8 · 100 % | 5/6 · 53,8 % | 1 | 0 s |
| Gemma 4 E2B | 14/14 · 100 % | 8/8 · 100 % | 6/6 · 84,6 % | 1 | 12,2 s |
| Gemma 4 E4B | 14/14 · 100 % | 8/8 · 100 % | 6/6 · 92,3 % | 0 | 19,9 s |

- **Die 100 % der Regeln sind geschönt** (Sätze und Regeln aus einer Hand; am Kontrollsatz wurde eine Frist-Regel
  nachgebessert). Kontrollsatz 2 zeigt die Grenzen.
- Erster KI-Lauf (E2B, vor Korrekturen): Testsatz nur 74 % richtig – das Modell schrieb ins Feld „Händler“ fast immer
  die Dokumentart („Rechnung“, „Kassenbon“) und als MwSt. den Satz („19 %“). Allgemein behoben, nicht pro Fall:
  Händler muss im Absender oder Text stehen und darf keine Dokumentart sein; Prozent ist kein Betrag; Netto/MwSt. nur,
  wenn sie als Betrag im Text stehen; Stichwort-Kategorie vor dem Vorschlag des Modells; sagt das Modell „kein Beleg“,
  die Regeln aber finden einen klaren Gesamtbetrag, bleibt der Beleg mit „bitte prüfen“. Dazu ISO-Daten (2026-09-28).
- Übrige Fehler: Belegdatum hinter „Date paid: Sep 21, 2026“ bzw. „Abgebucht am …“ nicht erkannt (Maildatum genommen);
  die Zahlungserinnerung (rx08) hält E2B für einen Beleg (E4B nicht).

## Versprechen-Tracker (W7.3, 02.10.2026)

Aufgabe: Zusagen in gesendeten („Meine Zusagen“) und eingegangenen Mails („Ich warte auf“) finden, Frist per Code aus dem
Ausdruck rechnen. Testsatz 24 Mails (17 Zusagen; Fallen: Bitten, Fragen, „anbei“, zitierter Text, Paketinfo, Werbung),
Kontrollsatz 12 (Englisch, „heute noch“, „gleich nachher“), **Kontrollsatz 2** 12 (Umgangssprache, Nebensätze,
Konjunktiv, Weiterleitung, verschobene Zusage; geschrieben nach dem Feinschliff der Regeln, danach nicht angepasst).

| Verfahren | Testsatz | Kontrollsatz | Kontrollsatz 2 | Frist richtig (gefundene) | Fehlalarme | Zeit (Median) |
|---|---|---|---|---|---|---|
| Regeln (ohne KI) | 17/17 | 9/9 | **0/11** | 26/26 | 0 | 0 s |
| Gemma 4 E2B | 17/17 | 9/9 | 5/11 | 31/31 | 0 | 4,1 s |
| Gemma 4 E4B | 17/17 | 9/9 | 8/11 | 33/34 | 0 | 7,0 s |

- Die Regeln sind auf den eigenen Sätzen fehlerfrei und versagen bei Umgangssprache völlig („Agenda kommt von mir“,
  „Schau ich mir an“, „will do – numbers coming your way“). Dort hilft das Modell.
- Erster KI-Lauf (E2B): Testsatz nur 15/17, Kontrollsatz 6/9 – Antwortete das Modell, galten nur seine Funde; sichere
  Regel-Treffer gingen verloren. Allgemein geändert: Modell- und Regel-Funde zusammen (Doppelte raus). Danach wie oben.
- Kein Fehlalarm in allen Sätzen. Übersehen werden vor allem Zusagen in dritter Person („unser Monteur kommt am
  Dienstag“, „die Versicherung wird sich melden“) und eine verschobene Zusage („Neuer Plan: Montag“).
- E4B nahm einmal den Anlass als Frist („wegen Samstag“ → Samstag).
- **Entscheidung:** wie überall E2B als Standard. **Ehrlich:** kleine Sätze aus einer Hand; echte Postfächer ungeprüft.

## Frag dein Postfach (W8.1, 03.10.2026)

Aufgabe: Frage in eigenen Worten → passende Mails finden → Antwort mit Quellenangabe. Postfach: 108 erfundene Mails
(Beispielkonten + Testsätze), 14 Fragen: 13 mit bekannter Quell-Mail, 1 **Falle** (Frage nach etwas, das nicht im Postfach
steht, aber ein ähnliches Thema hat: „Mieterhöhung“ vs. Preiserhöhung eines Handwerkers). Antwortmodell Gemma 4 E2B,
Suche nach Bedeutung mit EmbeddingGemma 300M (Q8_0, 256 Dimensionen), 4 CPU-Kerne.

| Suche | Quelle gefunden (Top 6) | Quelle auf Platz 1 | Antwort richtig (mit Quelle) | Falle erkannt | Zeit je Frage (Median) |
|---|---|---|---|---|---|
| Nur Wörter (Volltext) | 10/13 | 5/13 | 10/13 | 1/1 | 6,0 s |
| Bedeutung + Wörter | **13/13** | 11/13 | **13/13** | **0/1** | 13,7 s |

- Vorbereiten (Embeddings) der 108 Mails: 9–11 s.
- Die Suche nach Bedeutung findet auch Mails, in denen die Wörter der Frage nicht vorkommen (die 3 Fehlschläge der Wortsuche).
- **Die Falle wird mit Bedeutungssuche nicht erkannt:** E2B beantwortet die Mieterhöhungs-Frage mit der Preiserhöhung des
  Handwerkers. Prompt v2 („ähnliches Thema ist keine Antwort“) half nicht (gleiches Ergebnis wie v1). Darum zeigt die
  App immer die Quellen an. **Ehrlich:** nur eine Falle, kleine Sätze aus einer Hand; echte Postfächer ungeprüft.

## Autovervollständigung (W8.5, 03.10.2026)

Aufgabe: angefangenen Satz fortsetzen (höchstens 12 Wörter). Es gibt keine einzig richtige Fortsetzung – bewertet habe ich
jede Zeile von Hand („brauchbar“ = grammatisch, passend, nichts erfunden). Gemma 4 E2B, 4 CPU-Kerne, Skript
`packages/core/scripts/eval-complete.ts`. Testsatz 16 erfundene Entwürfe (du/Sie, Antwort mit Zitat, Englisch, Fallen
„Ich komme um …“), Kontrollsatz 12 (geschrieben nach der Abstimmung, danach nicht angepasst).

| Stand | Satz | brauchbar | holprig/falsch gezeigt | richtig unterdrückt | Zeit je Vorschlag (Median / max) |
|---|---|---|---|---|---|
| Prompt-Entwurf 1 (nur Regeln) | Testsatz | 0/16 | 16 (jede Antwort mit „-“, oft neuer Satz statt Fortsetzung) | 0 | 2,0 s / 2,9 s |
| Prompt mit Beispielen + Code-Prüfung | Testsatz | 11/16 | 2 („mich dich sofort darum“, „zu … habe ich“) | 3 (erfundene Uhrzeit „zwei Uhr“, erfundener „Sonntag“, „zu meiner ich …“) | 2,3 s / 3,2 s |
| dto. | **Kontrollsatz** | **9/12** | 3 („mir mir bitte …“, „einfach den Schlüssel einfach …“, „Vielleicht … vielleicht“) | 0 | 2,5 s / 2,9 s |
| + doppeltes Wort am Anschluss entfernt (allgemein) | Kontrollsatz | 10/12 | 2 | 0 | 2,3 s / 3,2 s |

- Für ein ~3B-Modell helfen **Beispiele** („Text → Fortsetzung“) deutlich mehr als Regeln im Prompt.
- Die Code-Prüfung ist nötig: Das Modell erfindet gern Uhrzeiten und Tage („ich komme um zwei Uhr“).
- **Ehrlich:** kleine, selbst geschriebene Sätze; Bewertung von Hand durch mich; die letzte Zeile ist nach einem Blick auf
  den Kontrollsatz entstanden (allgemeine Regel, aber nicht mehr unabhängig). Mit Temperatur 0,2 schwanken einzelne
  Vorschläge zwischen Läufen. Auf dem N97/iPad ungemessen – dafür schaltet sich die Funktion bei über 6 s selbst ab.

## Kontextfenster 16K (03.10.2026)

Auf Wunsch des Nutzers **ohne Messung** für alle Rechner eingestellt (16 384 Token, KV-Cache Q8_0 mit Rückfall auf F16).
Einzige Stichprobe: eine kurze Anfrage brauchte mit 4K/F16, 16K/F16 und 16K/Q8_0 je etwa 4 s (E2B, 4 Kerne).
**Ungeprüft:** Speicherbedarf und Tempo mit wirklich langen Eingaben auf schwacher Hardware (N97, 8 GB), Qualität
der Antworten bei vollem Fenster.

## Ergebnis und Entscheidung

- **Standard: Gemma 4 E2B.** Mit v2 98,8 % (Testsatz) bzw. 92,9 % (Kontrollsatz) richtig eingeordnet – Ziel ≥ 90 % erreicht –,
  schnellstes Modell (~3,7 s je Mail, ~13 s je Zusammenfassung auf 4 CPU-Kernen), versteht zusätzlich Bilder und Sprache.
  Laut Entscheidungsregel („Gemma wird Standard, wenn es beim deutschen Text nicht deutlich schlechter ist“) eindeutig:
  Gemma 4 E2B ist in diesem Test sogar besser als Qwen 3.5 2B.
- **Für stärkere Rechner: Gemma 4 E4B** – fehlerfrei in beiden Sätzen, aber etwa doppelt so langsam.
- **Qwen 3.5 2B** ist auf dieser CPU langsamer *und* ungenauer (Phishing, Fakten in Zusammenfassungen). **Qwen 3.5 4B** ist
  gut und bei „wer ist dran“ am besten (90 %), auf schwacher Hardware aber mit ~22 s je Mail am langsamsten.
- Die Phishing-Verbesserung durch v2 trägt auch im Kontrollsatz (Gemma E2B 1/4 → 3/4), ist also keine reine Überanpassung.

**Nachtrag 02.10.2026:** „Wer ist dran“ mit Prompt v4 bei beiden Gemma-Modellen 90 % (siehe Feinabstimmung oben).

**Offen (Stand vor der Feinabstimmung):** „Wer ist dran“ bleibt bei den Gemma-Modellen bei 60 % (v2 half nur Qwen 4B). Fakten in Zusammenfassungen 92 %
(Ziel Extraktion ≥ 95 %; fehlende Fakten betreffen meist Details bereits erledigter Vorgänge). Nächster Schritt: Prompt für
Zusammenfassungen gezielt verbessern (v3) und erneut messen. Messung auf dem N97 und mit Grafikkarte steht aus.
