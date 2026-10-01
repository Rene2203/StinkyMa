# Anmeldung per Browser (OAuth) einrichten – Gmail und Outlook

Mit OAuth meldest du dich in StinkyMa direkt bei Google bzw. Microsoft an („Mit Google anmelden“). Du brauchst dann
**kein App-Passwort** mehr, und StinkyMa sieht dein Passwort nie – es bekommt nur ein Zugriffs-Token, das verschlüsselt
(Windows: DPAPI) auf deinem PC liegt und das du jederzeit beim Anbieter widerrufen kannst.

Weil StinkyMa (noch) keine offiziell geprüfte App ist, braucht es eine **eigene App-Registrierung** bei Google bzw.
Microsoft. Das ist kostenlos und einmalig. Danach trägst du die Kennung in StinkyMa unter
**Optionen → Anmeldung per Browser (Gmail, Outlook)** ein.

> Stand 01.10.2026. Die Menüs von Google und Microsoft ändern sich gelegentlich – die Begriffe unten helfen beim Suchen.
> **Ungetestet gegen echte Konten**: Der Ablauf ist mit nachgestellten Anbietern und einem Testserver geprüft, die
> Einrichtung bei Google/Microsoft selbst konnte ich nicht ausprobieren. Bitte melde, wenn ein Schritt abweicht.

---

## Google (Gmail)

1. **Projekt anlegen:** <https://console.cloud.google.com/> → oben „Projekt auswählen“ → „Neues Projekt“, Name z. B. `StinkyMa`.
2. **Gmail API aktivieren** (schadet nicht, manche Konten brauchen es): „APIs & Dienste“ → „Bibliothek“ → „Gmail API“ → Aktivieren.
3. **Zustimmungsbildschirm** („Google Auth Platform“ bzw. „OAuth-Zustimmungsbildschirm“):
   - Zielgruppe/Nutzertyp: **Extern**.
   - App-Name: `StinkyMa`, Support-E-Mail: deine Adresse.
   - **Testnutzer**: deine Gmail-Adresse hinzufügen.
   - **Datenzugriff / Bereiche**: `https://mail.google.com/` hinzufügen (Google nennt ihn „eingeschränkt“).
4. **Veröffentlichungsstatus** – wichtig:
   - Im Status **„Testen“** läuft die Anmeldung bei Gmail-Zugriff **nach 7 Tagen ab**; du müsstest dich wöchentlich neu
     anmelden (StinkyMa zeigt dann am Konto „Erneut anmelden“).
   - Empfehlung für die private Nutzung: **„App veröffentlichen“** (Status „In Produktion“) – *ohne* Google-Prüfung.
     Beim Anmelden erscheint dann einmalig „Google hat diese App nicht überprüft“ → „Erweitert“ → „Weiter zu StinkyMa“.
     Das ist für eine eigene, nur von dir genutzte Registrierung in Ordnung.
5. **Client anlegen:** „Clients“ (bzw. „Anmeldedaten“ → „Anmeldedaten erstellen“ → „OAuth-Client-ID“) →
   Anwendungstyp **„Desktop-App“**, Name `StinkyMa Windows` → Erstellen.
6. **Client-ID** (endet auf `.apps.googleusercontent.com`) und **Clientschlüssel** kopieren und in StinkyMa unter
   Optionen → Anmeldung per Browser eintragen → Speichern. (Google sagt selbst, dass der Schlüssel einer Desktop-App
   nicht geheim ist – trotzdem nicht veröffentlichen.)
7. **Konto hinzufügen** → „Mit Google anmelden (Gmail)“ → im Browser anmelden und Zugriff erlauben → fertig.

Hast du Gmail schon mit App-Passwort eingerichtet? Konto in StinkyMa entfernen und per Google neu hinzufügen; das
App-Passwort danach in deinem Google-Konto löschen.

## Microsoft (Outlook.com, Hotmail, Microsoft 365)

1. **App registrieren:** <https://entra.microsoft.com/> (oder portal.azure.com) → „Anwendungen“ → „App-Registrierungen“ →
   „Neue Registrierung“.
   - Name: `StinkyMa`.
   - Unterstützte Kontotypen: **„Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“**.
   - Umleitungs-URI: Plattform **„Öffentlicher Client/nativ (mobil und Desktop)“**, Wert **`http://localhost`**.
2. **API-Berechtigungen** → „Berechtigung hinzufügen“ → „Microsoft Graph“ → „Delegierte Berechtigungen“:
   `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`, `openid`, `email` → Hinzufügen.
3. **Anwendungs-ID (Client-ID)** auf der Übersichtsseite kopieren (Form `xxxxxxxx-xxxx-…`) und in StinkyMa eintragen.
   Ein Geheimnis (Client Secret) ist **nicht** nötig.
4. Bei Outlook.com prüfen, dass IMAP erlaubt ist: Outlook im Browser → Einstellungen → E-Mail → „Weiterleitung und IMAP“.
5. **Konto hinzufügen** → „Mit Microsoft anmelden“.

Bei Firmenkonten (Microsoft 365) kann der Administrator die Anmeldung fremder Apps sperren – dann muss er zustimmen.

---

## Wie es technisch funktioniert (für später/Server)

- Anmeldung nach RFC 8252: StinkyMa öffnet die Anmeldeseite im Standardbrowser und wartet kurz auf einer Adresse nur auf
  diesem PC (`127.0.0.1` bzw. `localhost`, zufälliger Port). PKCE und ein zufälliger `state` verhindern, dass ein anderes
  Programm die Anmeldung abfängt oder unterschiebt.
- IMAP und SMTP melden sich per XOAUTH2 mit einem kurzlebigen Zugriffs-Token an; StinkyMa erneuert es automatisch.
- Wird die Anmeldung widerrufen oder läuft sie ab, zeigt das Konto ein Warnzeichen und den Knopf „Erneut anmelden“.
  Die Neu-Anmeldung muss mit derselben Adresse erfolgen.
- Code: `web/packages/core/src/oauth.ts`, `node/oauthLoopback.ts`, `mail/mailService.ts` (`#secretFor`).
