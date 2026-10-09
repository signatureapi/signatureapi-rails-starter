# Verifying a ceremony actually happened

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

Creating an envelope does not prove a recipient can sign it. Two branches
close that loop. Both start the same way. They diverge only at the point
where a human would normally click the link.

Test mode only.

## Why this loop defaults to `custom` authentication

`create-test-envelope.mjs` defaults `--auth` to `custom`, not to the API's own
default (`email_link`). That default exists only for this verification loop.
It is not a general recommendation for how to authenticate recipients.

`authentication` is an ordered array, not a single choice. The **first**
entry is the main method and decides whether the create response carries a
usable URL. Any later entry is an extra challenge the signer completes inside
the ceremony, and it never changes who delivers the URL. `--auth` takes a
comma-separated list, so `--auth email_link,email_code` produces
`[{email_link},{email_code}]`.

The main methods behave differently on the create response:

- `email_link` (the API default, and what production envelopes typically
  use): `ceremony.url` is `null` by design, in test mode and live mode alike.
  Possession of the emailed link is the recipient's authentication. So the
  API never exposes it outside the email itself. This holds whatever follows
  it in the array.
- `email_code`: `ceremony.url` is returned, but the ceremony still carries
  one unsatisfied challenge. The signer must type a code that only ever lives
  in the email log. This moves the email lookup to the signer's side without
  removing it.
- `custom`: `ceremony.url` is returned with no outstanding challenge. Nothing
  else needs to be fetched to reach a completable ceremony.

Branch B drives a headless script that cannot call MCP tools. So it cannot
read the email log at all. Only a first method of `custom` gives it a URL it
can act on directly. A first method of `email_code` also returns a URL, but a
human still has to relay the code. Branch A works with any of them. Using
`custom` there too keeps one recipe instead of two.

`[email_link, email_code]` is the combination to reach for when the
application should send no email of its own. SignatureAPI sends the
invitation link *and* the code, and the signer must still clear a second
factor. It is not a case where the integrator delivers the URL. That is only
true when `email_code` is the first method.

**`custom` authentication asserts that your application verified the
recipient's identity.** The `provider` and `data` values you pass are written
permanently into the envelope audit log. A reader of that log later has none
of this documentation in front of them. So `create-test-envelope.mjs`'s
default values are written to read as a plain denial, not a claim, when read
in isolation. They are `provider: "No identity verification performed"`, with
a `data` entry spelling out that no identity check occurred. That default is correct
for exactly two cases. First, a test-mode envelope built to verify an
integration end to end (this loop). Second, embedded signing where your
application genuinely authenticated the signer before creating the ceremony.
**It is the wrong choice for a production recipient your application has not
authenticated.** Those recipients use `email_link`, or a stronger method than
`custom` can honestly assert. Do not carry this default into production code
without re-deciding it for the recipient in front of you.

## Getting to the link

**Default (`custom`)**: the link is on the create response, at
`recipients[].ceremony.url`. Nothing further to fetch.

**`email_link` (the API default), or to read the `email_code` code the signer
needs**:

1. Create a test envelope with a recipient.
2. `list_emails` filtered by `envelope_id` to find the emails SignatureAPI
   generated for it.
3. Pick the `request`-type email (the signing invitation, not a receipt or
   deliverable notice).
4. `get_email` on that email's id. Read `ceremony_url` (and, for
   `email_code`, the code) from the response.

If MCP is unavailable, the dashboard email log is the fallback:
`https://dashboard.signatureapi.com/emails?mode=test`.

The public OpenAPI contract defines no email inspection operation. Do not
guess a REST path shaped like the MCP tools. Use the dashboard or stop.

**With `--auth email_code`**: the link is also available immediately, with no
email lookup, at `recipients[].ceremony.url` on the create response itself.
The signer still needs the code, fetched as above.

When the challenge says "The code starts with" and displays fixed digits,
those digits are an anchor. Enter only the corresponding remaining digits
into the editable inputs. Do not join every digit group from the email or
truncate a combined number to fit. If the UI does not establish the mapping,
hand the challenge to the human.

For an `email_link` envelope, the link obtained this way is for Branch A
only. Hand it to a human. It cannot be fed to `complete-ceremony.mjs`; see
Branch B below for why.

## Branch A — hand it to the human

Give the `ceremony_url` to the user. Wait for them to complete the ceremony
themselves. Then confirm completion with `list_events` (`envelope_id` plus
`wait_seconds`), or `watch-events.mjs --envelope <id>` over REST.

Use this branch whenever a human is available to sign. It needs no browser
automation.

## Branch B — walk it yourself

**Prerequisite:** Playwright is not one of this skill's dependencies. It is
heavy, and only this branch needs it. Install it before starting this walk,
not after hitting `PLAYWRIGHT_MISSING` at the last step:

    npm install --save-dev playwright && npx playwright install chromium

The browser walk completes envelopes whose places are signature places. That
is what `create-test-envelope.mjs` produces, and the only shape this branch
has ever been driven against. For an envelope containing `initials` or any
other place type, hand the link to a human (Branch A). That branch works for
every place type, because a human reads the page, not a selector.

The reason is a contract collision, not a missing feature. The signer UI's
`signature-input` and `adopt` attributes are shared between the signature
modal and the initials modal. On an envelope that has both, or an initials
place instead of a signature place, the walker's container selectors can
match more than one element. Under this script's fail-closed rule (see the
file header), that surfaces as `CEREMONY_CONTAINER_AMBIGUOUS` rather than a
silent wrong click. That is correct behavior, but the walk still cannot
complete that ceremony. Widening the walker to other place types needs new
contract attributes in the signer UI and its own test coverage. Do not route
around it here.

When no human is available, or the user has asked you to complete the
ceremony directly:

```
node scripts/complete-ceremony.mjs --envelope <envelope id>
```

The script refuses a live key. There is no flag to change that.

The script resolves the ceremony URL itself. It fetches the envelope with
your `SIGNATUREAPI_KEY`. That fetch is the actual test-mode gate: a test key
can only ever see a test envelope, so this cannot point at a live ceremony by
accident. It reads `recipients[].ceremony.url` from the response. It picks
the first recipient with a non-null one, or the one named by `--recipient
<key>`. This is why the loop defaults to `custom`. The script cannot call
MCP, so `email_link`'s null URL is a dead end here, not just an extra step.
If every ceremony URL is `null`, it fails with `CEREMONY_URL_NOT_RETURNED`.
Switch that recipient's authentication to `custom` or `email_code`, or use
Branch A instead.

This branch verifies envelopes whose `ceremony.url` the API actually returns.
`email_link` authentication returns `null` for every recipient's
`ceremony.url` by design. A live ceremony URL is driven by a browser, where
your API key plays no part. An agent that obtained one anyway (say, via
`list_emails` → `get_email`) must not feed it to this script. The script has
no API that maps a ceremony back to an envelope. So it cannot prove an
arbitrary URL belongs to a test-mode envelope, and completing an unverified
ceremony URL could sign something real. **For an `email_link` envelope, use
Branch A instead.** Hand the link to a human. That works for every
authentication method.

The script then drives a real Chromium browser through the ceremony: genuine
pointer movement to arm completion, then the primary signing action. A
consent modal is handled as a fallback if organic input was not detected. If
Playwright (see Prerequisite above) is not installed, the script reports
`PLAYWRIGHT_MISSING` with the install command as a safety net. Install it up
front instead of relying on that.

`--url` is an escape hatch for a `custom`-auth envelope whose ceremony URL
you already resolved some other way. Pass it alongside `--envelope <id>`,
never alone. The envelope fetch proves test mode. It also proves that the
supplied URL belongs to one of the envelope's ceremonies; if the envelope
returns no ceremony URLs at all, the script fails with
`EMAIL_LINK_URL_UNVERIFIABLE` (see above). The browser walk then uses the URL
you supplied without re-deriving it from the envelope response.

`--url` alone, with no `--envelope`, is refused outright. An unverified URL
cannot be proven to belong to a test-mode ceremony. There is no flag to
accept that risk instead: this script has no code path that can run against
a live ceremony. Always pass `--envelope`, with or without `--url` alongside
it.

After it reports `walked: true`, confirm completion with `list_events`
(`envelope_id` plus `wait_seconds`), or `watch-events.mjs --envelope <id>`
over REST. That is the same verification step as Branch A. Then
`get_deliverables` returns the signed PDF and audit log.

### Walk it the way an app embeds it

Add `--embedded <redirect|message>` when the integration embeds the ceremony.
The walk then also proves that the app would have received the result.

    node scripts/complete-ceremony.mjs --envelope <id> --embedded redirect
    node scripts/complete-ceremony.mjs --envelope <id> --embedded message

- `redirect` loads the ceremony top-level with `embedded=true&event_delivery=redirect`.
  This is how a native WebView loads it.
  The script records each navigation to a `signatureapi-message:` URL through the browser's Navigation API.
  That is the moment a WebView's navigation handler sees it.
- `message` serves a local host page at one `embeddable_in` origin of the recipient.
  The page frames the ceremony with `embedded=true&event_delivery=message`.
  It accepts a message only from the ceremony's origin and from its own iframe.
  Every other request to that origin is aborted, so no real host is contacted.

Message mode picks the first usable `embeddable_in` entry:

- An entry with a wildcard is skipped.
- An entry without a scheme is read as https.
- An https entry is used as is.
- An http loopback entry is used as is: `localhost`, `127.0.0.1`, or `[::1]`.
- Any other http entry is upgraded to https on the same host and port.
  The ceremony's frame policy treats `http://host` as allowing `https://host` too.

Without a usable entry it fails with `EMBED_ORIGIN_MISSING`.
Create the ceremony with `embeddable_in` listing that origin, or use `redirect`.

The frame counts as loaded only when two things hold.
Its document has the ceremony's origin.
It shows a known signer UI element.
A frame the ceremony refuses to load fails with `EMBED_FRAME_BLOCKED`.
The message names the chosen origin; list it in `embeddable_in`.

An embedded walk never confirms the "Confirm to continue" dialog.
That dialog means the signer UI saw no real pointer input.
An app's signer always produces that input, so the walk fails with `ORGANIC_INPUT_NOT_ARMED`.

Every flag takes `--name value` or `--name=value`.
A flag given without a value fails with `INVALID_FLAG_VALUE`.

The script reads events from the delivery mechanism only, never from console output.
It requires exactly one `ceremony.completed` event through the chosen mode.
Then it still polls the API for the recipient's status.
The success output adds `event` with `type` and `via`.

Failure codes for this mode:

- `INVALID_EMBEDDED_MODE`: the flag value is not `redirect` or `message`.
- `INVALID_FLAG_VALUE`: `--url`, `--envelope`, `--recipient` or `--timeout` has no usable value.
- `RECIPIENT_KEY_UNRESOLVED`: the script cannot tell which recipient it drives.
  Pass `--recipient <key>`.
- `EMBED_ORIGIN_MISSING`: no usable `embeddable_in` origin for message mode.
- `EMBED_HOST_PAGE_FAILED`: the local host page could not be served.
- `EMBED_FRAME_BLOCKED`: the ceremony did not load in the host page frame.
  Add the named origin to `embeddable_in`.
- `NAVIGATION_API_UNAVAILABLE`: the browser cannot report the redirect event.
  Reinstall Chromium with `npx playwright install chromium`.
- `CEREMONY_EVENT_NOT_DELIVERED`: no event reached the page.
- `CEREMONY_EVENT_UNEXPECTED`: a different event, more than one, or the wrong mode.
  A `ceremony.failed` event names its error type in the message.
  A step that never appears after such an event reports this code, not `CEREMONY_WALK_STEP_NOT_FOUND`.
- `ORGANIC_INPUT_NOT_ARMED`: the "Confirm to continue" dialog appeared.
  Produce real pointer input over the ceremony before Finish.
- `CEREMONY_WALK_ERROR`: an unexpected browser error stopped the walk.

An embedded walk also refuses any control labelled Cancel.
Embedded signers see Cancel instead of Decline.

## Admit the genuine deliverable

Status, events, parser success, and malware scanning prove different facts.
None proves that the application accepts the signed output. Retrieve the
genuine bytes and exercise the application's exact admission and storage
path from the approved design.

A signed PDF may contain a digital signature, form field, widget, annotation,
or appended audit page that an inert-upload policy rejects intentionally.
Treat that result as an application acceptance blocker. Design and verify a
separate bounded signed-output policy. Do not strip the signature, flatten
or rewrite the delivered bytes, or broadly permit active PDF features.
