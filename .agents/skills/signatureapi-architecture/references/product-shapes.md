# Product shapes

*Reference for the SignatureAPI signatureapi-architecture skill. It names
the REST calls an app makes and the tools an agent proves them with. Design
context, not production guidance on its own. Full workflow: SKILL.md.*

Four shapes are the most common starting points. They are not a menu.
A product often combines two, or departs from one in a way that matters.
Name the closest shape and the departures. Each shape lists four things. What the **application** calls (REST, in its own language). What
**you** use to prove it while you work (MCP tools and the
signatureapi-integrate scripts, never a runtime dependency of the app). The
decisions the design document must settle before building. The two mistakes
most likely in that shape.

Identifiers here are illustrations; the spec wins. Query it before writing a
body:

    node ../../signatureapi-integrate/scripts/openapi-explore.mjs operation post /envelopes
    node ../../signatureapi-integrate/scripts/openapi-explore.mjs schema Ceremony.CeremonyInput

**Tool availability.** When your client does not list a tool named here,
confirm the exact method and path in the public spec before using REST.
Some MCP inspection capabilities have no public REST equivalent. Never infer
one from the MCP tool name. Report the gap as the signatureapi-integrate
SKILL.md describes.

## Shape 1 — send-for-signature inside an existing application

The app already owns the document and the moment it should be signed (an
offer accepted, an order confirmed). Signing is a side effect of a domain
action. The signer is usually outside the app.

**The application calls**

1. Get a document URL. Preferred: the app stores the file in its own
   storage and passes a signed or public URL to it. Without storage of its
   own: `POST /uploads` with the file bytes and a `Content-Type` header,
   which returns a temporary `url`.
2. `POST /envelopes` with the document, the recipients, the places and
   `metadata`. Recipients default to `email_link` authentication, so
   SignatureAPI emails the signing link. Places are bound by
   `recipient_key`. `metadata` carries the app's own record id; it comes
   back on every event as `envelope_metadata`.
3. Persist the returned envelope `id` on the domain row.
4. Handle `deliverable.generated` on the app's existing inbound-HTTP path;
   `envelope.completed` can arrive before the signed file is ready. Then
   call `GET /envelopes/{envelopeId}/deliverables` and
   `GET /deliverables/{deliverableId}` to fetch the signed PDF and audit log.
   Store them where the app keeps documents.
5. For "the signer lost the email": `POST /recipients/{recipientId}/resend`.
   For "wrong person": `POST /recipients/{recipientId}/replace`.

**You prove it with**

- `whoami` to confirm account and mode. The user puts a `key_test_` key
  from the dashboard's API keys page into the project's env file; no tool
  returns one. Then `../../signatureapi-integrate/scripts/check-setup.mjs`.
- `../../signatureapi-integrate/scripts/make-test-document.mjs`, then
  `create_envelope` (or
  `../../signatureapi-integrate/scripts/create-test-envelope.mjs`).
- `list_events` with `wait_seconds` to watch `envelope.completed` arrive
  (over REST: `../../signatureapi-integrate/scripts/watch-events.mjs
  --envelope <id>`).
- `get_deliverables` to fetch the signed PDF and audit log with fresh URLs.
- `list_webhook_attempts` to tell "the event fired" apart from "my handler
  never ran".

**Decisions the design document must settle:**

- document source (app-generated vs upload)
- placeholder vs `fixed_positions`
- how many signers, and whether `routing` is `sequential`
- what the app does on completion, and where deliverables live
- whether the sender is the account or a per-customer `sender`

**Two mistakes**

- **Calling `POST /envelopes` inside the request the user is waiting on.**
  Creating the envelope belongs with the codebase's other non-blocking side
  effects (queue, job, domain event). See
  `../../signatureapi-integrate/references/brownfield-placement.md`.
- **Fetching the deliverable on `recipient.completed`.** The deliverable is
  generated after the envelope completes. Handle `deliverable.generated`
  and then fetch. Treat a `pending` or `processing`
  deliverable `status` as "not yet", not "missing".

## Shape 2 — embedded signing step

The signer is already logged in to the app, and signs inside it. The
ceremony renders in an iframe on the app's page, not from an emailed link.

**The application calls**

1. `POST /envelopes` as in Shape 1. Set each embedded recipient's `ceremony`
   to `custom` authentication and list the app's origin in `embeddable_in`.
   `custom` means the app asserts it verified the signer. The `provider` and
   `data` values are written into the audit log, so make them true
   statements. `redirect_url` is ignored for embedded ceremonies; the app
   learns the outcome from events instead.
2. Read `recipients[].ceremony.url` from the create response. Render it in
   an iframe for that signer only, on a page the signer had to log in to
   reach.
3. Handle `recipient.completed` to advance the app's own flow for that
   signer, and `envelope.completed` for the whole envelope. Fetch the
   deliverable as in Shape 1.
4. When a signer returns later and the link has expired or been revoked,
   `POST /recipients/{recipientId}/ceremonies` issues a new one. Any previous
   ceremony for that recipient is revoked.

For a signer who is *not* logged in (a counterparty outside the app), do not
embed. Give them `email_link` (or `email_code`, or `identity_verification`)
and a standalone ceremony with `redirect_url` pointing back at the app.
SignatureAPI appends the outcome, the envelope id and the recipient id as
query parameters. The exact names are in the spec's `Ceremony.RedirectUrl`
description. `redirect_delay` controls how long the completion screen shows
first.

**You prove it with**

- `create_envelope` with a `custom` recipient. Then open the returned
  ceremony URL in the app's page during development. Set `embeddable_in` to
  the dev origin, never `['*']` in code that ships.
- `create_ceremony` to exercise re-issuing a link.
- `list_events` (over REST:
  `../../signatureapi-integrate/scripts/watch-events.mjs`) to see
  `recipient.completed` and `envelope.completed`.
- Branch B (`../../signatureapi-integrate/scripts/complete-ceremony.mjs`)
  works here because a `custom` ceremony has no outstanding challenge. See
  `../../signatureapi-integrate/references/verification-loop.md`.

**Decisions the design document must settle:**

- which recipients are in-app (embedded, `custom`) and which are external
  (emailed)
- what the page does when the iframe reports completion
- how the app maps its own user to the recipient

**Two mistakes**

- **Using `custom` authentication for a recipient the app did not
  authenticate.** It is an assertion in the audit log. External signers get
  `email_link` or stronger; see
  `../../signatureapi-integrate/references/verification-loop.md`.
- **Serving the ceremony URL to the wrong session.** The URL is the
  credential for a `custom` ceremony. Render it only to the logged-in user
  who is that recipient. Never put it in a shared or cacheable response.
  Never store it anywhere a different user can read.

## Shape 3 — self-serve platform

The app's users bring their own documents, define where the fields go,
choose their signers, and send. The app is a signing product, and its
customers are the senders. This is the shape "a platform like X" usually
means. It has the most code outside SignatureAPI.

**The application calls**

1. `POST /uploads` with the user's file. This shape is the exception to
   the app-storage preference, because the structure read needs an upload
   id. Keep the returned upload id and `url`, and keep the app's own copy
   too. Read the upload's structure with `GET /uploads/{uploadId}/structure`:
   page count, page sizes, any placeholders found. The field-placement UI
   needs it to render pages at the right aspect ratio and to convert screen
   coordinates to PDF points, origin top-left.
2. Store the user's field layout as `fixed_positions` (`page`, `top`,
   `left`, `place_key`) plus the matching `places`. Bind each place to a
   recipient by `recipient_key`. Or, for template-driven senders, let them
   upload a DOCX and supply `data`.
3. Per customer, either `POST /senders` once and pass their verified email
   as the envelope `sender`, or send everything under the account's default
   sender. Email verification must complete before a sender can be used.
4. `POST /envelopes` when the user clicks send. The body carries their
   documents, their recipients (mostly `email_link`), their `routing`, and
   `metadata` with the platform's own ids. Add a `deliverable` configuration
   if the platform wants a `simple` or `standard` output or a password.
5. Handle the recipient events the platform's UI shows (`recipient.sent`,
   `recipient.viewed`, `recipient.completed`, `recipient.rejected`,
   `recipient.hard_bounced`) and `envelope.completed`. Fetch deliverables as
   in Shape 1 and file them under the sending user.
6. Expose the recipient operations users expect: resend (see Shape 1 step
   5), `POST /recipients/{recipientId}/replace`, and
   `POST /envelopes/{envelopeId}/cancel`.

**You prove it with**

- `mint_upload_url` (or
  `../../signatureapi-integrate/scripts/make-test-document.mjs`), then
  `inspect_upload` to confirm the page count and sizes your UI will draw
  on. Do not guess.
- `create_envelope` with `fixed_positions`. Then open the resulting document
  or a test render to confirm the fields landed where the UI showed them.
  Coordinate bugs never show in the create response.
- `list_events` (over REST:
  `../../signatureapi-integrate/scripts/watch-events.mjs`) for the
  per-recipient events the UI depends on. `replace_recipient` and
  `resend_request` to exercise the repair paths.
- `list_webhooks`, `create_webhook` and `list_webhook_attempts` for the
  endpoint the platform registers. Generate events with a synthetic test
  envelope; no MCP sample-delivery tool exists.
  `update_webhook` to point it elsewhere without recreating it.

**Decisions the design document must settle:** every decision in the matrix.
This shape has no defaults. In particular:

- whether users draw fields (a rendering and coordinate-mapping UI) or the
  platform only supports placeholders and templates
- whether each customer sends under a verified `sender`
- which deliverable type, and where it is stored per customer
- whether the platform goes live with one live key or per-customer isolation

**Two mistakes**

- **Placing fields on pages you never rendered.** A coordinate typed from a
  screenshot lands the field on the wrong spot. A page size assumed to be
  Letter lands it on the wrong page. Read the structure, render the page, convert
  coordinates, then verify on the generated document.
- **Modelling the platform on another vendor's objects.** Templates as a
  first-class server object, envelopes as editable drafts and per-tab field
  types do not exist here. An envelope is created complete. It is immutable
  except for `label`. Drafts and templates are the platform's own data. They
  become an envelope only at send time.

## Shape 4 — signing inside a native mobile app

The signer is logged in to the company's own iPhone or Android app, and
signs without leaving it. The ceremony loads in a WebView inside the app.
The app's server talks to SignatureAPI; the app itself never does.

**The application calls**

1. The app's server calls `POST /envelopes` as in Shape 2, with `custom`
   authentication for each in-app signer. Leave `redirect_url` unset;
   embedded ceremonies ignore it. Keep every SignatureAPI call on the
   server. An API key inside an app bundle is a leaked key.
2. The server returns `recipients[].ceremony.url` to that signer's app
   session only. The app appends `embedded=true&event_delivery=redirect`
   and loads the URL as the WebView's own page. A top-level WebView needs
   no `embeddable_in`.
3. The app catches the ceremony's result in the WebView's navigation
   handler. It is a navigation to `signatureapi-message://<event type>/`.
   On iOS use `webView(_:decidePolicyFor:decisionHandler:)`; on Android
   use `shouldOverrideUrlLoading`. Cancel the navigation, then read the
   event type from the URL host. No request reaches the network, so
   HTTP-layer interception never sees it.
4. The app handles `ceremony.completed`, `ceremony.canceled`,
   `ceremony.declined` and `ceremony.failed`. A failure carries an error
   type in the query string. Branch on it, and treat an unknown value as a
   generic failure.
5. Before acting on an outcome, the server confirms it. Read the envelope
   with `GET /envelopes/{envelopeId}`, or handle `recipient.completed`.
   Fetch the deliverable as in Shape 1.
6. When the signer comes back later, the app asks its server for the
   current URL. With the `standard` `url_variant`, every read of the
   envelope returns a fresh URL for the same ceremony. After expiry or
   revocation, `POST /recipients/{recipientId}/ceremonies` issues a new
   one, as in Shape 2.

Two alternatives exist. To receive a JavaScript message with no iframe,
load the ceremony top-level with `event_delivery=message`. Set no
`embeddable_in`. A document-start script forwards only terminal events,
and only from `https://sign.signatureapi.com` with `event.source ===
window`. To share a web SDK page, use a local page with an iframe. List
its origin in `embeddable_in`, and accept a message only from the ceremony
origin and the iframe's window. Prefer the top-level redirect. The rules
are in the "Native mobile apps" section of
`../../signatureapi-integrate/references/ceremonies.md`.
Per-platform code is in the
[iOS](https://signatureapi.com/docs/embedded/ios) and
[Android](https://signatureapi.com/docs/embedded/android) guides.

**You prove it with**

- `create_envelope` with a `custom` recipient and no `embeddable_in`. Then
  load the returned ceremony URL in the app on a simulator or emulator.
- Branch B with `--embedded redirect`
  (`../../signatureapi-integrate/scripts/complete-ceremony.mjs`). It checks
  that the ceremony delivers `ceremony.completed` over the redirect
  channel. Use `--embedded message` for the iframe alternative. See
  `../../signatureapi-integrate/references/verification-loop.md`.
- `list_events` (over REST:
  `../../signatureapi-integrate/scripts/watch-events.mjs`) to see
  `recipient.completed` and `envelope.completed`.
- The app's own UI tests with real input: XCUITest taps or UiAutomator
  gestures. Assert on the intercepted event. The ceremony arms completion
  only after input a person produces. A click dispatched from JavaScript
  does not count, and a "Confirm to continue" dialog then appears.

**Decisions the design document must settle:**

- top-level WebView with `event_delivery=redirect` (the default), or a
  local iframe page with `event_delivery=message`
- which recipients sign in the app (`custom`) and which are emailed
- what the app shows for each outcome, and whether it shows its own result
  screen (`redirect_delay` of `0`) or the ceremony's
- how the app maps its own user to the recipient, and how it gets a
  current URL when the signer returns

**Two mistakes**

- **Calling SignatureAPI from the app.** Anyone can unpack an app bundle
  and read the API key. Create envelopes and ceremonies on the app's
  server. Hand the app only that signer's ceremony URL. Do not log the URL
  or store it on the device.
- **Treating the WebView event as the outcome.** A ceremony event is a
  signal for the UI, not proof. Confirm the outcome on the server by
  reading the envelope or from a webhook before the app's flow moves on.
