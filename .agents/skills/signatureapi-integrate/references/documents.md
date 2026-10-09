# Documents

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

Most failed envelopes trace back to the source file, not the request. Check
these before the first create call. Limits (size, pages, places) are in the
spec: `node scripts/openapi-explore.mjs operation post /envelopes`.

## Where the file lives

- A document URL must point at a supported storage host, such as Amazon
  S3, Google Cloud Storage, Cloudflare R2, Azure Blob Storage or Vercel
  Blob. A signed URL with query parameters works. The full list is on
  https://signatureapi.com/docs/api/resources/documents/url.
- A URL on the app's own domain is rejected. Upload the bytes with
  `POST /uploads` instead, or move the file to a supported host.
- SignatureAPI fetches the file once, when the envelope is created. A
  signed URL only needs to live a few minutes.
- Upload from the application's backend. The upload call carries the API
  key, so a browser must never make it.

## DOCX files

- Set the document's `format` to `docx`. Without it the file is read as a
  PDF and fails to parse.
- DOCX files saved by Google Docs, LibreOffice or libraries such as
  PHPWord often fail to parse. Re-save them in Microsoft Word, or send a
  PDF when the flow needs no template data.
- Embed fonts in the DOCX. Non-Latin scripts, symbols and bullets fall back
  to a default font otherwise. When a script still renders wrong, generate
  the PDF yourself and send that.
- Template values in document `data` are strings, booleans or nested
  objects. Send an empty string for a missing value, never `null`.
- `\n` does not break a line inside a template value. Use the template's
  loop and list tags for repeated lines.

## PDF files

- Flatten a PDF that has fillable form fields before sending it. Its own
  form fields are not places, and they can render blank or stay editable
  in the signed file.
- Password-protected PDFs are not supported.
- Remove emoji from generated PDFs. A badly embedded emoji font can fail
  the envelope.
- Do not send an already signed PDF as a new document. Its existing
  signature can stall the new deliverable.

## Generated PDFs and placeholders

A placeholder is found by its text. PDFs printed from HTML (Chromium,
Puppeteer, Playwright, WebKit) often break that text:

- Ligatures join `fi`, `fl` and `ff` into one glyph. Turn them off for
  placeholder text, for example with `font-variant-ligatures: none`.
- Zero-width characters inside the marker make it unreadable. Build the
  marker from plain ASCII.

When a generated PDF still hides a placeholder, use `fixed_positions` for
that place.
