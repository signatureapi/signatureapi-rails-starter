#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. Builds and
// uploads a throwaway one-page test PDF with a place marker, so the Build
// steps have a document URL without improvising an upload flow. Test-mode
// tooling, not production code. Full workflow:
// SKILL.md.
import { ok, fail, apiBase, requireTestKey } from "./lib/output.mjs";

const API = apiBase();

/** A minimal one-page PDF carrying the [[signer_signature]] place marker. */
export function buildPdf() {
  const stream = "BT /F1 14 Tf 72 700 Td (Test Agreement) Tj 0 -40 Td (Sign here: [[signer_signature]]) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = requireTestKey(process.env.SIGNATUREAPI_KEY);
  const res = await fetch(`${API}/uploads`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/pdf" },
    body: buildPdf(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    fail("UPLOAD_FAILED", `HTTP ${res.status}: ${payload?.detail ?? "upload rejected"}`, [
      "Send raw PDF bytes as the body with Content-Type: application/pdf — not multipart, not JSON",
      "node scripts/check-setup.mjs",
    ]);
  }
  ok({
    document_url: payload.url,
    expires: "24 hours (temporary upload)",
    note: "The upload URL's host is always api.signatureapi.com, even when SIGNATUREAPI_BASE_URL points elsewhere (e.g. staging) — that's server behavior (uploads live on one shared host regardless of environment), not a bug. Use the URL as returned.",
    next: [`node scripts/create-test-envelope.mjs --document-url ${payload.url}`],
  });
}
