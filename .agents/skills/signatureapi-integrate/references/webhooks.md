# Webhooks

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

## Event types

The complete, current list of event types and each one's payload schema is in
the spec's `webhooks` section. Read it from there, not from memory:

    node scripts/openapi-explore.mjs webhooks

This skill's workflow depends on these:

- `envelope.completed`: everyone has finished. Mark the domain row.
- `deliverable.generated`: the signed file is ready. Fetch and store it
  here, not on `envelope.completed`, which can arrive first.
- `recipient.rejected`: a signer declined. The envelope is not cancelled
  for you.
- `recipient.soft_bounced` / `recipient.hard_bounced`: live-mode email
  delivery failures.

If this file and the spec disagree, the spec wins.

Events carry ids, not content. Captured input values (`capture_as`) are
not in any event; read them from the envelope. Deliverable download URLs
expire after an hour. Download the file and store it in the app's own
storage at once. Fetch a fresh URL later with `get_deliverables` or
`GET /envelopes/{envelopeId}/deliverables`.

## Event payload shape

Every event has the same envelope: `{id, type, timestamp, data: {...}}`.
`data` always carries `envelope_id`, `object_id`, `object_type`, plus fields
specific to the event type. Real example, captured from staging
(`GET /envelopes/{envelopeId}/events`):

```json
{
  "id": "evt_4ergJwldKlibL9pasqeyPf",
  "type": "envelope.completed",
  "timestamp": "2026-09-02T17:34:05.618Z",
  "data": {
    "envelope_id": "223c4d7d-10c3-4f69-8b82-f537158fe50a",
    "object_id": "223c4d7d-10c3-4f69-8b82-f537158fe50a",
    "object_type": "envelope",
    "envelope_metadata": {}
  }
}
```

There is no `data.envelope` object. Do not guess a nested shape. If you need
more than the id, fetch the envelope separately: `GET /envelopes/{envelopeId}`
from the application, or MCP `get_envelope` while you work.

## Registering an endpoint

**Local development, with a shell:** use the CLI. Start the handler, then
run this in a background shell:

    npx --yes signatureapi listen --forward-to http://127.0.0.1:<port>/<path>

- It opens a tunnel and registers a test-mode endpoint that points at it.
  Deliveries keep their original body and signature headers, so the
  handler verifies them exactly as in production.
- On first run it writes `SIGNATUREAPI_WEBHOOK_ID` and
  `SIGNATUREAPI_WEBHOOK_SECRET` to the env file, without printing the
  secret. A rerun reuses the same endpoint and secret.
- `--event <type>`, repeated, subscribes to a subset; the default is every
  event. `--env-path` picks another env file. `--public-url <https url>`
  replaces `--forward-to` when you run your own tunnel.
- `npx --yes signatureapi trigger envelope.completed` sends a labeled
  example to that endpoint only. It completes no envelope.
- The listener does not log deliveries; read the handler's output.
- Stopping the listener disables the endpoint. After a crash, rerun
  `listen` to repair it.

**An endpoint already hosted, or no shell:** use the MCP webhook tools.
`list_webhooks` first, to avoid a duplicate. Then `create_webhook` with the
URL and event types. The signing secret is never returned; the user copies
it from `signing_secret_dashboard_url` into the env file as
`SIGNATUREAPI_WEBHOOK_SECRET`. There is no MCP sample-delivery tool:
create a synthetic test envelope to generate real test events.
`list_webhook_attempts` shows each delivery, its response code and timing
(not the response body), which is how you tell "the event fired" apart
from "my handler never ran". Without MCP, use the dashboard:
`https://dashboard.signatureapi.com/settings/webhooks?mode=test`.

Test and live endpoints are separate. A test envelope never notifies a live
endpoint. Before a handler exists, watch events instead: `list_events` with
`wait_seconds`, or `scripts/watch-events.mjs`.

Most integrations need a handler. The app needs one when it acts on an
outcome: it marks a record signed, stores the signed file, or reacts to a
rejection or a bounce. Watching events proves the flow while you work. It
does not replace the handler. If the design has no handler, say so in the
remaining work, with the reason.

## Handler shape

Every delivery is signed under the Standard Webhooks spec. Verify it before
you trust the body. The signature covers three headers, `webhook-id`,
`webhook-timestamp` and `webhook-signature`, plus the raw body bytes. The
secret is `SIGNATUREAPI_WEBHOOK_SECRET` (`whsec_…`). Use the Standard
Webhooks library for the app's language
(https://github.com/standard-webhooks/standard-webhooks). Do not write the
HMAC by hand. Reject a failed check with 401 and do nothing else.

Verification needs the raw request bytes, not the parsed body. If the app
parses JSON globally (`app.use(express.json())` or equivalent), that parser
consumes the body first, and verification fails even though the code looks
right. Mount the webhook route before the global JSON parser, or exclude it
from that parser. In Express:

```js
import { Webhook } from "standardwebhooks";

const webhook = new Webhook(process.env.SIGNATUREAPI_WEBHOOK_SECRET);

// Register this BEFORE app.use(express.json()) — order matters.
app.post(
  "/webhooks/signatureapi",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    try {
      event = webhook.verify(req.body, req.headers); // raw Buffer + headers
    } catch {
      return res.sendStatus(401);
    }
    await handleEvent(event); // idempotent: key on event.id
    res.sendStatus(200);
  },
);

app.use(express.json()); // applies to every other route
```

Other frameworks: use whatever gives you the unparsed body, such as a
raw-body option or a hook that runs before body parsing.

Answer 2xx quickly. Any other status counts as a failed delivery and is
retried for up to 48 hours. Handlers must be idempotent: the same event can
arrive more than once. Delivery order is not guaranteed. Key on the event's
`id` to deduplicate, and re-read the envelope when the order matters.

Find the app's record by the envelope id. Store the envelope `id` on the
domain row when you create the envelope, then look up `data.envelope_id`.
Use `envelope_metadata` only as a fallback.

Take the outcome from the verified event, never from the ceremony return.
A `redirect_url` visit only says the browser came back. Anyone can load it
with any query string, and a signer can close the tab before it loads.
