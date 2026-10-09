---
name: signatureapi-diagnose
description: "Use when an existing SignatureAPI integration misbehaves. Covers an envelope stuck in processing, a missing webhook or signing email, an invalid or expired link, a missing signed document, or a 4xx error. Use it even for one missing email; test mode never sends real email. Read-only; safe on live envelopes."
allowed-tools: Read, Grep, WebFetch(domain:signatureapi.com), WebFetch(domain:spec.signatureapi.com)
inputs:
  - name: SIGNATUREAPI_KEY
    required: true
---

# Troubleshoot SignatureAPI

Start here: `node scripts/diagnose-envelope.mjs --envelope <id>`. It fetches
the envelope and its events in one pass and prints a verdict with next steps.

## When to reach for something else

- **Deciding how an app should use SignatureAPI** belongs to
  `signatureapi-architecture`.
- **Building a new signing flow** (creating envelopes, placing signature
  fields, wiring up a webhook for the first time) belongs to
  `signatureapi-integrate`.
- **How SignatureAPI is documented to behave** belongs to
  `signatureapi-docs`. Use it to compare an envelope's state with the
  documented behavior.
- **A webhook that is not a SignatureAPI webhook** belongs to whatever sent
  it. The symptoms and event shapes below are specific to SignatureAPI.
- **A different e-signature vendor** (DocuSign, Dropbox Sign, Adobe Sign,
  etc.) needs that vendor's own docs. The failure codes and symptoms here
  are SignatureAPI-specific.
- **A project with no SignatureAPI credentials present** has no envelope to
  diagnose yet. Confirm that first. Do not run this skill's scripts against
  a key that does not exist.

## Access

These are your tools for reading state. The customer's application does not
depend on them. The application integrates against the REST API
(`https://api.signatureapi.com/v1`, header `X-API-Key`). While diagnosing,
use MCP first (`https://mcp.signatureapi.com/mcp`): `whoami`, `get_envelope`
(takes `envelope_id`, not `id`), `list_envelopes`, `list_events`,
`list_webhooks`, `list_webhook_attempts`, `get_deliverables`, `list_emails`,
`get_email`. Reads by id work on test and live
envelopes alike. Listings take a per-call `mode` and default to test;
`whoami.modes.live` indicates access, not a session mode. Call `whoami`
only for an account question or a needed live-access check. Fall back to REST when a tool is missing. For documented behavior, use
`signatureapi-docs`. When you have to fall
back, report the gap at https://github.com/signatureapi/skills/issues/new.

Identifiers named below (paths, event types, status codes) are illustrations.
The published spec at `https://spec.signatureapi.com/openapi.yaml` is the
source of truth, and wins if the two disagree.

This skill only reads. Every script issues GET requests, so it is safe
against a live key during an incident. Each script reports the mode it ran
in. Run a script with `node --env-file=<project env file> scripts/…` so the
key loads without being printed.

The repair is a separate decision. Once the verdict is clear, name the fix
and ask before applying it. `resend_request` for a signer who lost the
email. `replace_recipient` for a bounced or wrong address. `create_ceremony`
for an expired link. In live mode each one emails a real person.

Read `SIGNATUREAPI_KEY` from the environment only. Never pass it as a
command-line argument. Argv is exposed in shell history and process listings
on any shared or logged system.

## Symptoms

### Envelope stuck in `processing`
Documents are still being fetched and prepared. Almost always an unreachable
document URL. Check two things: does every document URL return 200 to an
anonymous request, and is each file a valid PDF or DOCX?

### No webhook arrived
Split the question in two. Did the event happen? `list_events` with the
`envelope_id`, or `GET /envelopes/{envelopeId}/events`. Was it delivered?
`list_webhook_attempts` for the endpoint shows each delivery and the
response code your handler returned. No attempt means the endpoint is not
subscribed to that event type, or is in the other mode. A non-2xx attempt
means your handler ran and failed. A 401 or 400 on every attempt usually
means signature verification fails. Check three things: the handler
verifies the raw body, not re-serialized JSON; it reads the `webhook-id`,
`webhook-timestamp` and `webhook-signature` headers; and its secret belongs
to this endpoint and mode. Test and live endpoints are separate. A
test envelope never notifies a live endpoint.

### Recipient never got the email
In **test mode no email is ever sent**. That is by design. Read what would
have been sent with `list_emails`, then `get_email`. Only test signing-request emails expose rendered content and ceremony
links. Authentication-code subjects and content are withheld. In live mode, look for
`recipient.soft_bounced` / `recipient.hard_bounced` events.

### Ceremony link does not work
Links are single-recipient and expire. For `email_link` recipients the link
is the authentication. So the API never returns it in live mode. Only the
test-mode email log exposes it.

### Deliverable missing after completion
Check for a `deliverable.generated` event, then `get_deliverables` (or
`GET /envelopes/{envelopeId}/deliverables`). A `pending` or `processing`
status means not yet, not missing.

### "Invalid link" or an expired link
Creating a ceremony revokes every earlier link for that recipient. Look for
code that creates ceremonies more than once: a retried webhook handler, or
an email scanner opening a link that creates one on open. Links also expire,
after 30 days by default. The fix is a fresh link (`create_ceremony` or a
resend). Ask before applying it.

### Envelope creation rejects the document
- The URL host is not a supported storage host: upload the file instead.
- "Could not be parsed as a PDF" on a DOCX: `format` is missing.
- A DOCX from Google Docs, LibreOffice or a DOCX library fails to parse:
  re-save it in Microsoft Word.
- A placeholder is "not found" in a PDF printed from HTML: ligatures or
  zero-width characters split the marker text.

### 422 on create
See `references/errors.md` for the response shape and the most common cause.
Check the exact schema in the OpenAPI spec at
`https://spec.signatureapi.com/openapi.yaml`.

## References

- `references/errors.md` — HTTP status codes and what they mean here
