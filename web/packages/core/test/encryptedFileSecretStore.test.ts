import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretKeys } from "../src/index.js";
import { EncryptedFileSecretStore, SecretStoreUnavailableError, type StringEncryptor } from "../src/node/index.js";

// Test-Verschlüsselung: umkehrbar, aber Klartext ist in der Datei nicht lesbar.
const fakeEncryptor = (available = true): StringEncryptor => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain, "utf8")].map((b) => b ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((b) => b ^ 0x5a)).toString("utf8"),
});

describe("EncryptedFileSecretStore", () => {
  const dirs: string[] = [];
  const tempFile = () => {
    const dir = mkdtempSync(join(tmpdir(), "stinkyma-secrets-"));
    dirs.push(dir);
    return join(dir, "sub", "secrets.json");
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("speichert verschlüsselt und liest wieder", async () => {
    const file = tempFile();
    const store = new EncryptedFileSecretStore(file, fakeEncryptor());
    const key = SecretKeys.accountPassword("icloud");
    expect(await store.get(key)).toBeNull();
    await store.set(key, "abcd-efgh-ijkl-mnop");
    expect(await store.get(key)).toBe("abcd-efgh-ijkl-mnop");
    expect(readFileSync(file, "utf8")).not.toContain("abcd-efgh");
    // Neue Instanz liest dieselbe Datei
    expect(await new EncryptedFileSecretStore(file, fakeEncryptor()).get(key)).toBe("abcd-efgh-ijkl-mnop");
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
    await store.remove(key);
  });

  it("speichert nichts ohne Verschlüsselung", async () => {
    const store = new EncryptedFileSecretStore(tempFile(), fakeEncryptor(false));
    await expect(store.set(SecretKeys.aiApiKey("x"), "geheim")).rejects.toBeInstanceOf(SecretStoreUnavailableError);
    expect(await store.get(SecretKeys.aiApiKey("x"))).toBeNull();
  });

  it("hält Schlüssel auseinander", async () => {
    const store = new EncryptedFileSecretStore(tempFile(), fakeEncryptor());
    await store.set(SecretKeys.accountPassword("a"), "pw");
    await store.set(SecretKeys.oauthRefreshToken("a"), "token");
    expect(await store.get(SecretKeys.accountPassword("a"))).toBe("pw");
    expect(await store.get(SecretKeys.oauthRefreshToken("a"))).toBe("token");
  });
});
