import { rmSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
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


/** Prüft, dass ein Bereich wirklich scrollt (Inhalt größer als sichtbar, Mausrad bewegt ihn). */
export async function expectScrollable(page: Page, selector: string): Promise<void> {
  const area = page.locator(selector).first();
  const { scrollHeight, clientHeight } = await area.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scrollHeight, `${selector}: Inhalt sollte höher als der sichtbare Bereich sein`).toBeGreaterThan(clientHeight);
  await area.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => area.evaluate((el) => el.scrollTop), { message: `${selector} scrollt nicht` }).toBeGreaterThan(0);
  await area.evaluate((el) => el.scrollTo(0, 0));
}
