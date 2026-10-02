import type Database from "better-sqlite3";

// Schema und Migrationen – gleiche Tabellen wie MailSchema.swift (Spezifikation, Abschnitt 8).
// Bestehende Migrationen nie ändern, sondern neue anhängen. Der Stand steht in `PRAGMA user_version`.

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    name: "v1-core",
    sql: `
      CREATE TABLE account (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        displayName TEXT NOT NULL,
        provider TEXT NOT NULL,
        imapHost TEXT NOT NULL,
        imapPort INTEGER NOT NULL,
        smtpHost TEXT NOT NULL,
        smtpPort INTEGER NOT NULL,
        authType TEXT NOT NULL,
        color TEXT NOT NULL,
        aiCloudAllowed INTEGER NOT NULL DEFAULT 0,
        sortOrder INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE mailbox (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        uidValidity INTEGER,
        highestModSeq INTEGER,
        UNIQUE (accountId, name)
      );
      CREATE INDEX mailbox_on_accountId_role ON mailbox(accountId, role);

      CREATE TABLE thread (
        id TEXT PRIMARY KEY NOT NULL,
        subject TEXT NOT NULL,
        participants TEXT NOT NULL,
        lastDate TEXT NOT NULL,
        summary TEXT,
        summaryUpdatedAt TEXT
      );

      -- Kein WITHOUT ROWID: die Volltextsuche (FTS5, externer Inhalt) braucht die rowid.
      CREATE TABLE message (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        mailboxId TEXT NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
        uid INTEGER,
        messageId TEXT,
        threadId TEXT NOT NULL REFERENCES thread(id) ON DELETE RESTRICT,
        fromName TEXT,
        fromAddress TEXT NOT NULL,
        "to" TEXT NOT NULL,
        cc TEXT NOT NULL,
        subject TEXT NOT NULL,
        date TEXT NOT NULL,
        snippet TEXT NOT NULL,
        bodyText TEXT,
        bodyHTML TEXT,
        flags INTEGER NOT NULL DEFAULT 0,
        hasAttachments INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        priorityScore REAL,
        snoozedUntil TEXT
      );
      CREATE INDEX message_on_accountId ON message(accountId);
      CREATE INDEX message_on_threadId ON message(threadId);
      CREATE INDEX message_on_mailboxId_date ON message(mailboxId, date);
      CREATE INDEX message_on_fromAddress ON message(fromAddress);
      CREATE INDEX message_on_messageId ON message(messageId);
      CREATE UNIQUE INDEX message_on_mailboxId_uid ON message(mailboxId, uid) WHERE uid IS NOT NULL;

      CREATE TABLE attachment (
        id TEXT PRIMARY KEY NOT NULL,
        messageId TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        size INTEGER NOT NULL,
        localPath TEXT,
        sha256 TEXT,
        isInline INTEGER NOT NULL DEFAULT 0,
        contentId TEXT,
        pageCount INTEGER,
        isEncrypted INTEGER NOT NULL DEFAULT 0,
        relevance TEXT,
        relevanceReason TEXT,
        documentType TEXT,
        analysisStatus TEXT NOT NULL DEFAULT 'pending',
        riskFlags INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX attachment_on_messageId ON attachment(messageId);
      CREATE INDEX attachment_on_sha256 ON attachment(sha256);

      CREATE TABLE attachmentAnalysis (
        attachmentId TEXT PRIMARY KEY NOT NULL REFERENCES attachment(id) ON DELETE CASCADE,
        summary TEXT,
        extractedJSON TEXT,
        modelId TEXT NOT NULL,
        privacyClass TEXT NOT NULL,
        analyzedAt TEXT NOT NULL
      );

      CREATE TABLE attachmentText (
        attachmentId TEXT PRIMARY KEY NOT NULL REFERENCES attachment(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL
      );

      CREATE TABLE embedding (
        messageId TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        chunkIndex INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (messageId, chunkIndex)
      );

      CREATE TABLE behaviorEvent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT REFERENCES message(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX behaviorEvent_on_timestamp ON behaviorEvent(timestamp);

      CREATE TABLE senderProfile (
        address TEXT PRIMARY KEY NOT NULL,
        domain TEXT NOT NULL,
        interactionRate REAL,
        avgReplyTime REAL,
        userPriority INTEGER
      );
      CREATE INDEX senderProfile_on_domain ON senderProfile(domain);

      CREATE TABLE styleProfile (
        recipientGroup TEXT PRIMARY KEY NOT NULL,
        greeting TEXT,
        closing TEXT,
        formality TEXT,
        examples TEXT
      );

      CREATE TABLE reminder (
        id TEXT PRIMARY KEY NOT NULL,
        messageId TEXT REFERENCES message(id) ON DELETE SET NULL,
        dueDate TEXT NOT NULL,
        text TEXT NOT NULL,
        eventKitId TEXT
      );

      CREATE TABLE aiModel (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        providerType TEXT NOT NULL,
        filePath TEXT,
        sizeBytes INTEGER,
        quantization TEXT,
        paramCount INTEGER
      );
    `,
  },
  {
    name: "v1-fts",
    // Volltextindex über Betreff, Absender und Text, per Trigger synchron, ohne Umlaut-Empfindlichkeit.
    sql: `
      CREATE VIRTUAL TABLE messageFTS USING fts5(
        subject, fromName, fromAddress, snippet, bodyText,
        content='message', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2', prefix='2 3'
      );
      CREATE TRIGGER message_fts_ai AFTER INSERT ON message BEGIN
        INSERT INTO messageFTS(rowid, subject, fromName, fromAddress, snippet, bodyText)
        VALUES (new.rowid, new.subject, new.fromName, new.fromAddress, new.snippet, new.bodyText);
      END;
      CREATE TRIGGER message_fts_ad AFTER DELETE ON message BEGIN
        INSERT INTO messageFTS(messageFTS, rowid, subject, fromName, fromAddress, snippet, bodyText)
        VALUES ('delete', old.rowid, old.subject, old.fromName, old.fromAddress, old.snippet, old.bodyText);
      END;
      CREATE TRIGGER message_fts_au AFTER UPDATE ON message BEGIN
        INSERT INTO messageFTS(messageFTS, rowid, subject, fromName, fromAddress, snippet, bodyText)
        VALUES ('delete', old.rowid, old.subject, old.fromName, old.fromAddress, old.snippet, old.bodyText);
        INSERT INTO messageFTS(rowid, subject, fromName, fromAddress, snippet, bodyText)
        VALUES (new.rowid, new.subject, new.fromName, new.fromAddress, new.snippet, new.bodyText);
      END;
    `,
  },
  {
    name: "v2-account-connection",
    // Anmeldename, Verbindungssicherheit und Sync-Status pro Konto (Phase W2). Gleich in MailSchema.swift.
    sql: `
      ALTER TABLE account ADD COLUMN username TEXT NOT NULL DEFAULT '';
      ALTER TABLE account ADD COLUMN imapSecurity TEXT NOT NULL DEFAULT 'tls';
      ALTER TABLE account ADD COLUMN smtpSecurity TEXT NOT NULL DEFAULT 'starttls';
      ALTER TABLE account ADD COLUMN lastSyncAt TEXT;
      ALTER TABLE account ADD COLUMN syncError TEXT;
    `,
  },
  {
    name: "v3-pending-actions",
    // Warteschlange für Aktionen, die noch zum Mailserver müssen (Spezifikation 4.3: offline-fähig).
    // Die Oberfläche zeigt Änderungen sofort; übertragen wird im Hintergrund. Gleich in MailSchema.swift.
    sql: `
      CREATE TABLE pendingAction (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        messageId TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT
      );
      CREATE INDEX pendingAction_on_accountId_id ON pendingAction(accountId, id);
    `,
  },
  {
    name: "v4-remote-content-exceptions",
    // Absender (Adresse oder Domain), deren externe Bilder sofort geladen werden (Spezifikation 7.2).
    // Swift zieht das später nach – siehe docs/SWIFT-NACHHOLEN.md.
    sql: `
      CREATE TABLE remoteContentException (
        pattern TEXT PRIMARY KEY NOT NULL,
        createdAt TEXT NOT NULL
      );
    `,
  },
  {
    name: "v5-outbox",
    // Postausgang: gesendete Mails bleiben hier, bis der Server sie angenommen hat (offline-fähig, 4.3).
    // mail = Eingaben aus dem Composer (JSON, zum erneuten Bearbeiten), raw = fertige MIME-Nachricht.
    // sentAt gesetzt = SMTP hat angenommen, fehlt nur noch die Ablage in „Gesendet“ (nie doppelt senden).
    sql: `
      CREATE TABLE outbox (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        mail TEXT NOT NULL,
        raw BLOB NOT NULL,
        messageId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        sentAt TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        failed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX outbox_on_accountId_createdAt ON outbox(accountId, createdAt);
    `,
  },
  {
    name: "v6-drafts",
    // Entwürfe: lokal sofort gespeichert (mail = Composer-Eingaben als JSON), sichtbar als Mail im Ordner
    // „Entwürfe“ (messageId). Die Server-Kopie (serverUid) wird gebündelt ersetzt; dirty = muss zum Server,
    // deleted = Server-Kopie muss noch gelöscht werden.
    sql: `
      CREATE TABLE draft (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        mail TEXT NOT NULL,
        messageId TEXT NOT NULL DEFAULT '',
        serverUid INTEGER,
        serverMailboxId TEXT,
        updatedAt TEXT NOT NULL,
        dirty INTEGER NOT NULL DEFAULT 1,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX draft_on_accountId ON draft(accountId);
      CREATE INDEX draft_on_messageId ON draft(messageId);
    `,
  },
  {
    name: "v7-account-signature",
    // Signatur pro Konto (HTML-Fragment aus dem Editor).
    sql: `
      ALTER TABLE account ADD COLUMN signatureHtml TEXT;
    `,
  },
  {
    name: "v8-attachment-search",
    // Suchindex über den Text von Anhängen (PDF, Text) – gleiche Regeln wie für Mails (ohne Akzente, Wortanfang).
    sql: `
      CREATE VIRTUAL TABLE attachmentFTS USING fts5(
        text,
        content='attachmentText', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2', prefix='2 3'
      );
      INSERT INTO attachmentFTS(rowid, text) SELECT rowid, text FROM attachmentText;
      CREATE TRIGGER attachment_fts_ai AFTER INSERT ON attachmentText BEGIN
        INSERT INTO attachmentFTS(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER attachment_fts_ad AFTER DELETE ON attachmentText BEGIN
        INSERT INTO attachmentFTS(attachmentFTS, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER attachment_fts_au AFTER UPDATE ON attachmentText BEGIN
        INSERT INTO attachmentFTS(attachmentFTS, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO attachmentFTS(rowid, text) VALUES (new.rowid, new.text);
      END;
    `,
  },
  {
    name: "v9-ai-results",
    // KI-Ergebnisse: Herkunft der Kategorie (Gerät/Server/Cloud/Regeln/Nutzer) und Zusammenfassungen je Konversation
    // samt Modell, Prompt-Version und Stand (letzte Mail), damit veraltete Zusammenfassungen erkennbar sind.
    sql: `
      ALTER TABLE message ADD COLUMN categoryOrigin TEXT;
      CREATE INDEX message_on_uncategorized ON message(date) WHERE category IS NULL;
      CREATE TABLE threadSummary (
        threadId TEXT PRIMARY KEY NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        openPoints TEXT NOT NULL,
        waitingOn TEXT NOT NULL,
        modelId TEXT NOT NULL,
        privacyClass TEXT NOT NULL,
        promptVersion INTEGER NOT NULL,
        lastMessageDate TEXT NOT NULL,
        messageCount INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      );
    `,
  },
  {
    name: "v10-message-actions",
    // Erkannte Aktionen (Termin, Frist, To-do, Zahlung) je Mail samt Beleg-Zitat und Status; welche Mails schon
    // untersucht sind; Erinnerungen hängen an einer Aktion und haben einen Status (offen, gemeldet, abgesagt).
    sql: `
      CREATE TABLE messageAction (
        id TEXT PRIMARY KEY NOT NULL,
        messageId TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT,
        time TEXT,
        amount TEXT,
        quote TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        origin TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX messageAction_on_messageId ON messageAction(messageId);
      CREATE INDEX messageAction_open_on_date ON messageAction(date) WHERE status = 'open';
      CREATE TABLE messageActionScan (
        messageId TEXT PRIMARY KEY NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        promptVersion INTEGER NOT NULL,
        scannedAt TEXT NOT NULL
      );
      ALTER TABLE reminder ADD COLUMN actionId TEXT;
      ALTER TABLE reminder ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      CREATE INDEX reminder_pending_on_dueDate ON reminder(dueDate) WHERE status = 'pending';
    `,
  },
  {
    name: "v11-screener",
    // Türsteher: pro Konto an/aus; Entscheidungen je Absender-Adresse (klein geschrieben) gelten für alle Konten.
    sql: `
      ALTER TABLE account ADD COLUMN screener INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE senderDecision (
        address TEXT PRIMARY KEY NOT NULL,
        decision TEXT NOT NULL,
        decidedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Regeln in normaler Sprache (W6.4). `definition` ist JSON (RuleDefinition in core/src/rules.ts).
    // ruleQueue: neu angekommene Posteingangs-Mails, die noch durch die Regeln müssen (wartet ggf. auf die Einordnung).
    name: "v12-mail-rules",
    sql: `
      CREATE TABLE mailRule (
        id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        accountId TEXT REFERENCES account(id) ON DELETE CASCADE,
        definition TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE ruleQueue (
        messageId TEXT PRIMARY KEY NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        queuedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Vom Nutzer korrigierte Einordnung, gemerkt je Absender (klein geschrieben): künftige Mails bekommen sie ohne Modell.
    name: "v13-sender-category",
    sql: `
      CREATE TABLE senderCategory (
        address TEXT PRIMARY KEY NOT NULL,
        category TEXT NOT NULL,
        learnedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Zeitraum für den Abgleich je Konto in Tagen: NULL = Standard (30), 0 = alle Mails.
    name: "v14-account-sync-days",
    sql: `
      ALTER TABLE account ADD COLUMN syncDays INTEGER;
    `,
  },
  {
    // Abmelde-Angabe der Mail (JSON; '' = keine; NULL = noch nicht gelesen) und wen der Nutzer abbestellt hat.
    name: "v15-unsubscribe",
    sql: `
      ALTER TABLE message ADD COLUMN listUnsubscribe TEXT;
      CREATE TABLE unsubscribed (
        address TEXT PRIMARY KEY NOT NULL,
        method TEXT NOT NULL,
        requestedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Verträge & Abos (W7.1): ein Eintrag je Anbieter (Absender-Domain) und Konto; geprüfte Mails merken.
    name: "v16-subscriptions",
    sql: `
      CREATE TABLE subscription (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
        providerKey TEXT NOT NULL,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount TEXT,
        amountCents INTEGER,
        interval TEXT,
        startDate TEXT,
        minTermMonths INTEGER,
        trialEnd TEXT,
        termEnd TEXT,
        renewalDate TEXT,
        cancelBy TEXT,
        notice TEXT,
        lastCancelDay TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sourceMessageId TEXT REFERENCES message(id) ON DELETE SET NULL,
        lastMailDate TEXT NOT NULL,
        quote TEXT NOT NULL,
        origin TEXT NOT NULL,
        userEdited INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE UNIQUE INDEX subscription_on_provider ON subscription(accountId, providerKey);
      CREATE TABLE subscriptionScan (
        messageId TEXT PRIMARY KEY NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        promptVersion INTEGER NOT NULL,
        scannedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Abos nachgebessert: alle Mails je Abo (Rechnungen aus mehreren Monaten), Zusammenführen auch über verschiedene
    // Absender-Domains (Zahlungsdienste, von Hand zusammengeführt) – deshalb kein eindeutiger Index mehr je Domain.
    name: "v17-subscription-mails",
    sql: `
      CREATE TABLE subscriptionMail (
        subscriptionId TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
        messageId TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount TEXT,
        PRIMARY KEY (subscriptionId, messageId)
      );
      CREATE INDEX subscriptionMail_on_message ON subscriptionMail(messageId);
      INSERT INTO subscriptionMail (subscriptionId, messageId, date, amount)
        SELECT id, sourceMessageId, lastMailDate, amount FROM subscription WHERE sourceMessageId IS NOT NULL;
      ALTER TABLE subscription ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
      DROP INDEX subscription_on_provider;
      CREATE INDEX subscription_on_provider ON subscription(accountId, providerKey);
    `,
  },
  {
    // Eigene Kategorien: zusätzlich zur festen Einordnung (die bleibt für Schutz beim Aufräumen, Abos, Tagesüberblick).
    // `userCategoryChecked`: Stand der Kategorien, gegen den das Modell die Mail geprüft hat (ändern sie sich, neu prüfen).
    name: "v18-user-categories",
    sql: `
      CREATE TABLE userCategory (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        senders TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL,
        sortOrder INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      ALTER TABLE message ADD COLUMN userCategory TEXT;
      ALTER TABLE message ADD COLUMN userCategoryOrigin TEXT;
      ALTER TABLE message ADD COLUMN userCategoryChecked TEXT;
      CREATE INDEX message_on_userCategory ON message(userCategory);
      CREATE TABLE senderUserCategory (
        address TEXT PRIMARY KEY NOT NULL,
        categoryId TEXT NOT NULL REFERENCES userCategory(id) ON DELETE CASCADE,
        learnedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Belegordner (W7.2): ein Beleg je Mail. Bleibt erhalten, auch wenn die Mail aus StinkyMail verschwindet
    // (kürzerer Zeitraum) – deshalb keine Fremdschlüssel-Löschung, Absender/Betreff/Datum als Kopie.
    name: "v19-receipts",
    sql: `
      CREATE TABLE receipt (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL,
        messageId TEXT,
        merchant TEXT NOT NULL,
        date TEXT NOT NULL,
        grossCents INTEGER,
        netCents INTEGER,
        vatCents INTEGER,
        currency TEXT NOT NULL DEFAULT 'EUR',
        invoiceNumber TEXT,
        dueDate TEXT,
        category TEXT,
        quote TEXT NOT NULL DEFAULT '',
        review TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        origin TEXT NOT NULL,
        userEdited INTEGER NOT NULL DEFAULT 0,
        mailSubject TEXT NOT NULL,
        mailFrom TEXT NOT NULL,
        mailDate TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE UNIQUE INDEX receipt_on_messageId ON receipt(messageId);
      CREATE INDEX receipt_on_date ON receipt(date);
      CREATE TABLE receiptScan (
        messageId TEXT PRIMARY KEY NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        promptVersion INTEGER NOT NULL,
        scannedAt TEXT NOT NULL
      );
      CREATE TABLE receiptCategory (
        name TEXT PRIMARY KEY NOT NULL,
        sortOrder INTEGER NOT NULL
      );
      INSERT INTO receiptCategory (name, sortOrder) VALUES
        ('Arbeitsmittel', 0),
        ('Handwerker & Dienstleistungen', 1),
        ('Spenden', 2),
        ('Versicherungen', 3),
        ('Gesundheit', 4),
        ('Haushalt & Einkauf', 5),
        ('Fahrtkosten & Reisen', 6),
        ('Sonstiges', 7);
      CREATE TABLE receiptMerchantCategory (
        merchantKey TEXT PRIMARY KEY NOT NULL,
        category TEXT NOT NULL,
        learnedAt TEXT NOT NULL
      );
    `,
  },
  {
    // Versprechen-Tracker (W7.3): Zusagen aus gesendeten („mine“) und eingegangenen („theirs“) Mails. `followUpMessageId`:
    // spätere Mail im selben Verlauf, die die Zusage vermutlich erfüllt (die App schlägt „erledigt“ vor).
    name: "v20-promises",
    sql: `
      CREATE TABLE promise (
        id TEXT PRIMARY KEY NOT NULL,
        accountId TEXT NOT NULL,
        messageId TEXT,
        threadId TEXT NOT NULL,
        direction TEXT NOT NULL,
        counterpartName TEXT,
        counterpartAddress TEXT NOT NULL,
        text TEXT NOT NULL,
        quote TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        dueStated INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        followUpMessageId TEXT,
        origin TEXT NOT NULL,
        mailSubject TEXT NOT NULL,
        mailDate TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX promise_on_messageId ON promise(messageId);
      CREATE INDEX promise_open_on_dueDate ON promise(dueDate) WHERE status = 'open';
      CREATE TABLE promiseScan (
        messageId TEXT PRIMARY KEY NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        promptVersion INTEGER NOT NULL,
        scannedAt TEXT NOT NULL
      );
    `,
  },
];

/** Bringt die Datenbank auf den neuesten Stand. Jede Migration läuft in einer eigenen Transaktion. */
export function migrate(db: Database.Database): string[] {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current > migrations.length) {
    throw new Error(`Datenbank ist neuer als diese App (Schema ${current}, bekannt bis ${migrations.length}).`);
  }
  const applied: string[] = [];
  migrations.slice(current).forEach((migration, offset) => {
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${current + offset + 1}`);
    })();
    applied.push(migration.name);
  });
  return applied;
}
