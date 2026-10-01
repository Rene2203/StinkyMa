// Test-Mails (erfunden).

export const sampleReply = [
  "From: Petra Schulz <p.schulz@moebelhaus.example>",
  "To: Anna Beispiel <anna@example.test>",
  "Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe_aus_M=C3=BCnchen?=",
  "Date: Tue, 29 Sep 2026 10:00:00 +0200",
  "Message-ID: <m1@moebelhaus.example>",
  "In-Reply-To: <m0@example.test>",
  "References: <m0@example.test>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="XYZ"',
  "",
  "--XYZ",
  'Content-Type: multipart/alternative; boundary="ALT"',
  "",
  "--ALT",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
  "",
  "Hallo Anna,",
  "",
  "anbei das Angebot.",
  "",
  "Am 28.09.2026 schrieb Anna:",
  "> Kannst du mir das Angebot schicken?",
  "--ALT",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Hallo Anna,</p><p>anbei das <b>Angebot</b>.</p><img src=\"https://tracker.example/pixel.gif\">",
  "--ALT--",
  "--XYZ",
  'Content-Type: application/pdf; name="Angebot.pdf"',
  'Content-Disposition: attachment; filename="Angebot.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 test").toString("base64"),
  "--XYZ--",
  "",
].join("\r\n");

/** Kleinstes gültiges PDF mit einer Textzeile (erfunden, für Tests der Textauslese). */
export function minimalPdf(line: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
