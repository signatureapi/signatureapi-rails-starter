# HTTP errors

*Reference for the SignatureAPI signatureapi-diagnose skill. Diagnostic
context, not production guidance on its own. Full runbook: SKILL.md.*

Error responses use RFC 7807 problem details:

```json
{ "type": "https://...", "title": "...", "status": 422, "detail": "..." }
```

`detail` is the specific, actionable part. Read it first.

## Status codes

**401** — the API key was rejected. Confirm `SIGNATUREAPI_KEY` is set and
current, and starts with a lowercase `key_`; pasted keys often gain a
capital letter. A `live-mode-disabled` type means the key is live but live
mode is not active on the account; it needs a subscription.

**403** — the key is valid but not permitted for this action.

**404** — usually a mode mismatch, not a missing resource. Test and live are
separate namespaces. A test key can never see a live envelope, and vice
versa. Confirm the id's mode matches the key's mode before assuming it does
not exist.

**409** — the envelope is already in a final state (for example, cancelling
a completed envelope). Check `status` on the envelope first.

**422** — validation failure. `detail` names the offending field. Common
causes:

- A place's `recipient_key` matches no recipient `key`.
- Field names in camelCase or PascalCase. Every field is snake_case; set
  the app's JSON serializer to match.
- `[[...]]` text in the document with no matching place, or a key used
  twice in one document.
- A `blocked-email` type: the address hard-bounced before. Correct it.

**429** — rate limited. Back off and retry with increasing delay.

**5xx** — a server-side failure. Retry with backoff. If it persists, contact
support@signatureapi.com with the request id.
