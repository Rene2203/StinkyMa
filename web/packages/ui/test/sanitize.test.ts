// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../src/sanitize.js";

describe("HTML-Mails säubern", () => {
  it("entfernt Skripte, Ereignis-Handler, Formulare und Frames", () => {
    const { html } = sanitizeEmailHtml(
      '<p onclick="alert(1)">Hallo</p><script>alert(2)</script><form action="https://evil.example"><input name="pw"></form><iframe src="https://evil.example"></iframe><a href="javascript:alert(3)">x</a>',
    );
    expect(html).toContain("Hallo");
    expect(html).not.toMatch(/script|onclick|<form|<input|<iframe|javascript:/i);
  });

  it("blockiert externe Bilder und Hintergründe, zählt sie", () => {
    const result = sanitizeEmailHtml(
      '<img src="https://tracker.example/p.gif" width="1"><img src="data:image/png;base64,AAAA"><div style="background:url(https://x.example/bg.png)">x</div>',
    );
    expect(result.blockedRemote).toBe(2);
    expect(result.html).not.toContain("tracker.example");
    expect(result.html).not.toContain("x.example");
    expect(result.html).toContain("data:image/png");
  });

  it("Links öffnen außerhalb der App", () => {
    const { html } = sanitizeEmailHtml('<a href="https://example.org/info">Info</a><a href="mailto:a@example.org">Mail</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("mailto:a@example.org");
  });

  it("lässt normale Formatierung stehen", () => {
    const { html, blockedRemote } = sanitizeEmailHtml('<table><tr><td style="color:red"><b>Fett</b></td></tr></table>');
    expect(html).toContain("<b>Fett</b>");
    expect(html).toContain("color:red");
    expect(blockedRemote).toBe(0);
  });

  it("blockiert externe Adressen auch in <style>-Blöcken und @import", () => {
    const result = sanitizeEmailHtml(
      '<p>Hallo</p><style>body{background:url("https://t.example/bg.png")} @import url(https://t.example/x.css); p{color:red}</style>',
    );
    expect(result.html).not.toContain("t.example");
    expect(result.html).toContain("color:red");
    expect(result.blockedRemote).toBe(2);
  });

  it("lädt externe Bilder nur auf Wunsch – Skripte bleiben trotzdem draußen", () => {
    const mail = '<img src="https://bilder.example/logo.png"><div style="background:url(https://bilder.example/bg.png)">x</div><script>alert(1)</script><img src="x" onerror="alert(2)">';
    const blocked = sanitizeEmailHtml(mail);
    expect(blocked.html).not.toContain("bilder.example");
    expect(blocked.remoteCount).toBe(2);

    const loaded = sanitizeEmailHtml(mail, { allowRemote: true });
    expect(loaded.html).toContain('src="https://bilder.example/logo.png"');
    expect(loaded.html).toContain("bilder.example/bg.png");
    expect(loaded.html).not.toMatch(/script|onerror/i);
    expect(loaded.remoteCount).toBe(2);
    expect(loaded.blockedRemote).toBe(0);
  });
});
