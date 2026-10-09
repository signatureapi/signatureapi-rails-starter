# Places

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

A place is an interactive region on a document. It is bound to one recipient
by `recipient_key`, which must match that recipient's `key` exactly.

The list of place types, the fields each type takes, and the constraints on
`key` live in the spec, not here. Read them from it before writing a place:

    node scripts/openapi-explore.mjs schema Place.Type
    node scripts/openapi-explore.mjs schema Place.PlaceInput

`Place.Type` is the complete list of types, with a line on what each one does
(signature, initials, text inputs, checkbox, dropdown, radio group, dates,
recipient name and email). `Place.PlaceInput` names the schema for each type.
If anything in this file and that output disagree, the spec wins.

## Inventory the document by format

Read the source file or its extracted text before building the request.
Classify every binding that SignatureAPI will interpret:

| Format | Syntax | Meaning | Must match |
| --- | --- | --- | --- |
| PDF or DOCX | `[[place_key]]` | Current place placeholder | `places[].key` |
| PDF or DOCX | `[[recipient_key.signature]]` | Legacy signature placeholder | `recipients[].key` |
| PDF or DOCX | `fixed_positions[].place_key` | Coordinate position | `places[].key` |
| DOCX only | `{{person.name}}` | Template value | The nested path in document `data` |
| DOCX only | `{{if ...}}` and range tags | Template control | Compatible values and template structure |

Curly-brace template syntax is not interpreted in PDF. A DOCX may combine
template data with square-bracket place placeholders. Read the detailed
[template](https://signatureapi.com/docs/api/resources/documents/templates)
and [positioning](https://signatureapi.com/docs/api/resources/places/positioning)
rules when either syntax is present.

Before creation, report the bindings found, their request targets, and any
unresolved item. Stop when any binding is unresolved. A current placeholder
must match a place key exactly. A legacy signature placeholder uses its
recipient key and does not become a current place automatically.

## Position current places

**Default: a `[[place_key]]` marker in the document text**, for example
`[[signer_signature]]`. The key matches one place object exactly.
SignatureAPI replaces the marker with that rendered place. This is
verifiable because its intended position remains visible in the source.

**Fallback: `fixed_positions`.** Explicit `page`, `top` and `left`
coordinates, in PDF points from the top-left corner of the page. Use this
only when you cannot edit the document to add a marker, for example a
third-party or generated PDF whose source you do not control. Coordinates
guessed without a preview of the rendered result are a common source of
misplaced fields. Every fixed position's `place_key` must match a declared
place. Fixed positions do not disable or replace other placeholders already
embedded in the document. Generate the envelope, then open a test render and
confirm placement.

## Placeholder rules

- Any `[[...]]` text in a document is read as a placeholder. Every one
  needs a matching place, or creation fails with a 422. Remove stray
  bracket text from the file.
- A key appears once per document. It may repeat across documents in the
  same envelope.
- `{{ }}` is template data, never a place. `{{signature}}` in a DOCX is
  read as a missing data value.
- The marker text stays in the document under the place. Colour it white
  in the source file so it does not show.
- PDFs printed from HTML can hide a marker from the text search. See
  `documents.md`.

## Read the document before placing anything

Call `inspect_upload` (MCP) with the upload id from `mint_upload_url` or
`POST /uploads`. Without MCP, first confirm and then call the exact REST
operation `GET /uploads/{uploadId}/structure`. It returns page dimensions
and bindings detected by the service.

Compare its result with the local inventory. Reconcile every detected
binding, not only the ones you planned to use. Before fixed positioning,
confirm the target page and its real dimensions. Never assume Letter or A4.
