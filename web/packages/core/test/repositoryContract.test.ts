import { describe, expect, it } from "vitest";
import {
  InMemoryMailRepository,
  MockIds,
  createMockData,
  isFlagged,
  isRead,
  type MailRepository,
} from "../src/index.js";
import { SqliteMailRepository, openDatabase, seedIfEmpty } from "../src/sqlite/index.js";

// Beide Implementierungen müssen sich gleich verhalten – dieselben Tests laufen gegen beide.
const now = new Date("2026-09-29T10:00:00Z");

const implementations: [string, () => MailRepository][] = [
  ["InMemory", () => new InMemoryMailRepository(createMockData(now))],
  [
    "SQLite",
    () => {
      const db = openDatabase(":memory:");
      seedIfEmpty(db, createMockData(now));
      return new SqliteMailRepository(db);
    },
  ],
];

describe.each(implementations)("MailRepository (%s)", (_name, make) => {
  it("sortiert Konten", async () => {
    const accounts = await make().accounts();
    expect(accounts.map((a) => a.id)).toEqual([MockIds.iCloud, MockIds.gmail, MockIds.work]);
  });

  it("zeigt den Posteingang zuerst, eigene Ordner zuletzt", async () => {
    const boxes = await make().mailboxes(MockIds.iCloud);
    expect(boxes).toHaveLength(7);
    expect(boxes[0]?.role).toBe("inbox");
    expect(boxes.at(-1)?.name).toBe("Finanzen");
  });

  it("gemeinsamer Posteingang: nur Posteingänge, neueste zuerst, alle Konten", async () => {
    const messages = await make().messages({ kind: "unifiedInbox" }, 100);
    const inboxes = [MockIds.iCloud, MockIds.gmail, MockIds.work].map((id) => MockIds.mailbox(id, "inbox"));
    expect(messages.length).toBeGreaterThan(10);
    expect(messages.every((m) => inboxes.includes(m.mailboxId))).toBe(true);
    const dates = messages.map((m) => m.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(messages.map((m) => m.accountId)).size).toBe(3);
  });

  it("beachtet das Limit", async () => {
    expect(await make().messages({ kind: "unifiedInbox" }, 3)).toHaveLength(3);
  });

  it("Ungelesen-Bereich und Zähler stimmen überein", async () => {
    const repo = make();
    const unread = await repo.messages({ kind: "unread" }, 100);
    expect(unread.every((m) => !isRead(m))).toBe(true);
    expect(await repo.unreadCount({ kind: "unifiedInbox" })).toBe(unread.length);
    expect(await repo.unreadCount({ kind: "unread" })).toBe(unread.length);
  });

  it("Markiert: über Ordner hinweg, aber ohne Papierkorb", async () => {
    const repo = make();
    const flagged = await repo.messages({ kind: "flagged" }, 100);
    expect(flagged).toHaveLength(2);
    await repo.move([flagged[0]!.id], "trash");
    expect(await repo.messages({ kind: "flagged" }, 100)).toHaveLength(1);
  });

  it("Thread: älteste zuerst, über Ordner hinweg", async () => {
    const thread = await make().thread("mock-thread-relaunch");
    expect(thread).toHaveLength(3);
    expect(thread.map((m) => m.date)).toEqual(thread.map((m) => m.date).sort());
    expect(new Set(thread.map((m) => m.mailboxId)).size).toBe(2);
  });

  it("setFlag setzt und entfernt nur dieses Flag", async () => {
    const repo = make();
    const [target] = await repo.messages({ kind: "unread" }, 1);
    await repo.setFlag("seen", true, [target!.id]);
    const read = await repo.message(target!.id);
    expect(read && isRead(read)).toBe(true);
    await repo.setFlag("seen", false, [target!.id]);
    expect((await repo.message(target!.id))?.flags).toBe(target!.flags);
    await repo.setFlag("flagged", true, [target!.id]);
    const flaggedNow = await repo.message(target!.id);
    expect(flaggedNow && isFlagged(flaggedNow)).toBe(true);
  });

  it("verschiebt in den Ordner des jeweiligen Kontos", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const icloud = inbox.find((m) => m.accountId === MockIds.iCloud)!;
    const work = inbox.find((m) => m.accountId === MockIds.work)!;
    await repo.move([icloud.id, work.id], "archive");
    expect((await repo.message(icloud.id))?.mailboxId).toBe(MockIds.mailbox(MockIds.iCloud, "archive"));
    expect((await repo.message(work.id))?.mailboxId).toBe(MockIds.mailbox(MockIds.work, "archive"));
    expect(await repo.messages({ kind: "unifiedInbox" }, 100)).toHaveLength(inbox.length - 2);
  });

  it("ohne Zielordner bleibt die Mail, wo sie ist", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const gmail = inbox.find((m) => m.accountId === MockIds.gmail)!;
    await repo.move([gmail.id], "custom"); // „custom“ gibt es nur im iCloud-Konto
    expect((await repo.message(gmail.id))?.mailboxId).toBe(gmail.mailboxId);
  });

  it("leere ID-Listen sind erlaubt", async () => {
    const repo = make();
    await repo.setFlag("seen", true, []);
    await repo.move([], "trash");
  });

  it("Anhänge gehören zur Mail, alphabetisch", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const invoice = inbox.find((m) => m.subject === "Ihre Abschlagsrechnung Oktober")!;
    expect(invoice.hasAttachments).toBe(true);
    expect((await repo.attachments(invoice.id)).map((a) => a.filename)).toEqual(["AGB.pdf", "Rechnung_2026-10.pdf"]);
  });

  it("overview liefert Konten, Ordner und dieselben Zähler wie unreadCount", async () => {
    const repo = make();
    const { accounts, mailboxesByAccount, counts } = await repo.overview();
    expect(accounts.map((a) => a.id)).toEqual((await repo.accounts()).map((a) => a.id));
    expect(mailboxesByAccount[MockIds.iCloud]?.map((m) => m.id)).toEqual((await repo.mailboxes(MockIds.iCloud)).map((m) => m.id));
    expect(counts.unifiedInbox).toBe(await repo.unreadCount({ kind: "unifiedInbox" }));
    expect(counts.unread).toBe(await repo.unreadCount({ kind: "unread" }));
    expect(counts.flagged).toBe(await repo.unreadCount({ kind: "flagged" }));
    for (const box of Object.values(mailboxesByAccount).flat()) {
      expect(counts.mailboxes[box.id] ?? 0, box.id).toBe(await repo.unreadCount({ kind: "mailbox", mailboxId: box.id }));
    }
  });

  it("unbekannte Mail ergibt null", async () => {
    expect(await make().message("gibt-es-nicht")).toBeNull();
  });

  it("Ausnahmen für externe Inhalte: hinzufügen (vereinheitlicht), doppelt ignorieren, entfernen", async () => {
    const repo = make();
    expect(await repo.remoteContentExceptions()).toEqual([]);
    expect(await repo.addRemoteContentException("Shop <News@Shop.example>")).toBe("news@shop.example");
    await repo.addRemoteContentException("zeitung.example");
    await repo.addRemoteContentException("@zeitung.example");
    expect(await repo.remoteContentExceptions()).toEqual(["news@shop.example", "zeitung.example"]);
    await expect(repo.addRemoteContentException("kein gültiger eintrag")).rejects.toThrow(/E-Mail-Adresse oder Domain/);
    await repo.removeRemoteContentException("news@shop.example");
    expect(await repo.remoteContentExceptions()).toEqual(["zeitung.example"]);
  });

  it("Senden ohne Server (Beispielkonto): landet in „Gesendet“, Original „beantwortet“", async () => {
    const repo = make();
    const original = (await repo.messages({ kind: "unifiedInbox" }, 50)).find((m) => m.accountId === MockIds.iCloud)!;
    await repo.send({
      accountId: MockIds.iCloud,
      to: [original.from],
      cc: [],
      bcc: [],
      subject: `Re: ${original.subject}`,
      bodyText: "Danke!",
      answeredMessageId: original.id,
    });
    const sent = await repo.messages({ kind: "mailbox", mailboxId: MockIds.mailbox(MockIds.iCloud, "sent") }, 50);
    const copy = sent.find((m) => m.subject === `Re: ${original.subject}`)!;
    expect(copy.threadId).toBe(original.threadId);
    expect(isRead(copy)).toBe(true);
    expect(((await repo.message(original.id))!.flags & 2) !== 0).toBe(true);
    expect((await repo.overview()).outbox).toEqual([]);
  });

  it("Entwürfe: speichern erscheint in „Entwürfe“, erneut speichern ersetzt, öffnen, senden löscht den Entwurf", async () => {
    const repo = make();
    const draftsId = MockIds.mailbox(MockIds.iCloud, "drafts");
    const before = (await repo.messages({ kind: "mailbox", mailboxId: draftsId }, 50)).length;
    const draft = { mode: "new" as const, accountId: MockIds.iCloud, to: [{ address: "anna@example.test" }], cc: [], bcc: [], subject: "Entwurf 1", bodyText: "Hallo", bodyHtml: "<p>Hallo</p>" };
    const id = await repo.saveDraft(null, draft);
    await repo.saveDraft(id, { ...draft, subject: "Entwurf 2" });
    const drafts = await repo.messages({ kind: "mailbox", mailboxId: draftsId }, 50);
    expect(drafts).toHaveLength(before + 1);
    const mine = drafts.find((m) => m.subject === "Entwurf 2")!;
    expect(mine.flags & 16).toBe(16);
    expect(await repo.openDraft(mine.id)).toMatchObject({ draftId: id, subject: "Entwurf 2", bodyHtml: "<p>Hallo</p>", to: [{ address: "anna@example.test" }] });

    await repo.send({ ...draft, subject: "Entwurf 2", draftId: id });
    const after = await repo.messages({ kind: "mailbox", mailboxId: draftsId }, 50);
    expect(after.some((m) => m.subject === "Entwurf 2")).toBe(false);
    expect(after).toHaveLength(before);
  });

  it("Entwürfe: löschen und fremde Entwürfe (vom Server) öffnen", async () => {
    const repo = make();
    const draftsId = MockIds.mailbox(MockIds.work, "drafts");
    const existing = (await repo.messages({ kind: "mailbox", mailboxId: draftsId }, 50))[0]!;
    const opened = await repo.openDraft(existing.id);
    expect(opened).toMatchObject({ mode: "new", accountId: MockIds.work, subject: existing.subject });
    expect(opened?.draftId).toBeTruthy();
    expect(await repo.openDraft((await repo.messages({ kind: "unifiedInbox" }, 1))[0]!.id)).toBeNull(); // keine Mail aus dem Posteingang

    const id = await repo.saveDraft(null, { mode: "new", accountId: MockIds.work, to: [], cc: [], bcc: [], subject: "Weg damit", bodyText: "" });
    await repo.deleteDraft(id);
    expect((await repo.messages({ kind: "mailbox", mailboxId: draftsId }, 50)).some((m) => m.subject === "Weg damit")).toBe(false);
  });

  it("Adressvorschläge: Name oder Adresse, eigene Adressen fehlen, Grenzen und Sonderzeichen", async () => {
    const repo = make();
    expect(await repo.suggestAddresses("jonas", 5)).toEqual([{ name: "Jonas Weber", address: "jonas.weber@post.example" }]);
    expect((await repo.suggestAddresses("schulz", 5))[0]?.address).toBe("p.schulz@moebelhaus-schulz.example");
    expect((await repo.suggestAddresses("anna.beispiel", 5)).map((a) => a.address)).not.toContain("anna.beispiel@icloud.example");
    expect(await repo.suggestAddresses("", 5)).toEqual([]);
    expect(await repo.suggestAddresses("%", 5)).toEqual([]);
    expect((await repo.suggestAddresses("example", 3)).length).toBeLessThanOrEqual(3);
  });

  it("Signatur setzen und wieder entfernen", async () => {
    const repo = make();
    await repo.setSignature(MockIds.iCloud, "<p>Viele Grüße</p>");
    expect((await repo.accounts()).find((a) => a.id === MockIds.iCloud)?.signatureHtml).toBe("<p>Viele Grüße</p>");
    await repo.setSignature(MockIds.iCloud, "<p></p>");
    expect((await repo.accounts()).find((a) => a.id === MockIds.iCloud)?.signatureHtml ?? null).toBeNull();
  });
});

// Gmail: „Alle Nachrichten“ (Archiv) enthält jede Mail des Posteingangs ein zweites Mal.
describe.each([
  ["InMemory", (data: ReturnType<typeof createMockData>) => new InMemoryMailRepository(data) as MailRepository],
  [
    "SQLite",
    (data: ReturnType<typeof createMockData>) => {
      const db = openDatabase(":memory:");
      seedIfEmpty(db, data);
      return new SqliteMailRepository(db) as MailRepository;
    },
  ],
])("Archiv-Kopien (%s)", (_name, make) => {
  it("eine markierte Mail, die auch im Archiv liegt, erscheint in „Markiert“ nur einmal", async () => {
    const data = createMockData(now);
    const flaggedBefore = await make(createMockData(now)).messages({ kind: "flagged" }, 100);
    const original = data.messages.find((m) => isFlagged(m) && m.messageId && data.mailboxes.find((b) => b.id === m.mailboxId)?.role === "inbox")!;
    const archive = data.mailboxes.find((b) => b.accountId === original.accountId && b.role === "archive")!;
    data.messages.push({ ...original, id: `${original.id}-kopie`, mailboxId: archive.id, uid: 999 });
    const repo = make(data);
    const flagged = await repo.messages({ kind: "flagged" }, 100);
    expect(flagged.map((m) => m.id).sort()).toEqual(flaggedBefore.map((m) => m.id).sort());
    expect((await repo.overview()).counts.flagged).toBe((await make(createMockData(now)).overview()).counts.flagged);
    // Im Archiv selbst bleibt die Kopie sichtbar
    expect((await repo.messages({ kind: "mailbox", mailboxId: archive.id }, 100)).some((m) => m.id === `${original.id}-kopie`)).toBe(true);
  });
});

