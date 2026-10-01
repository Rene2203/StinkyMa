import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";

/**
 * GreenMail öffnet den Port, bevor er Befehle annimmt (in der Windows-CI sichtbar: alle Tests scheiterten
 * direkt nach dem Start mit „Command failed“). Deshalb warten, bis ein echter Befehl durchgeht.
 */
export async function waitForGreenMail(host: string, port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const probe = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user: `probe-${randomUUID().slice(0, 8)}@example.test`, pass: "x" }, logger: false });
    try {
      await probe.connect();
      await probe.mailboxCreate("Probe");
      await probe.logout();
      return;
    } catch (error) {
      lastError = error;
      probe.close();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`GreenMail nimmt keine Befehle an: ${String((lastError as { responseText?: string })?.responseText ?? lastError)}`);
}
