import { rmSync } from "node:fs";

/**
 * Temporäre Testordner aufräumen. Unter Windows können Hilfsprozesse von Electron Dateien noch kurz sperren
 * (EBUSY) – das ist kein Testfehler, deshalb nur „bestmöglich“ löschen.
 */
export function removeQuietly(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(`Temporärer Testordner nicht gelöscht (${(error as NodeJS.ErrnoException).code ?? "Fehler"}): ${dir}`);
  }
}
