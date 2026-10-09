# Ceremonies and recipients

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

These are the behaviours that break integrations after the first test
envelope works. Field names come from the spec; check them there.

## One live link per recipient

- A recipient has one active ceremony. Creating another revokes every
  earlier link, and the signer sees "invalid link". Create a ceremony
  once per signing session, and make the code path idempotent. A retried
  webhook handler that creates ceremonies is the usual cause.
- Email scanners, Gmail's especially, open links before the signer does.
  When the app emails a link it creates on open, point the email at an app
  page that creates the ceremony when the signer clicks.
- Ceremony links expire, after 30 days by default. For embedded signing,
  create the ceremony once. Before each show, read the envelope for a
  fresh URL. For an emailed link, resend it instead of reusing an old one.

## Custom authentication

`custom` means the app vouches for the signer. It needs a `provider` name
and a non-empty `data` object. Both go into the audit log. Put the evidence
that links the signing to the app's login there: user id, session id, and
when they authenticated. Read the exact shape with
`node scripts/openapi-explore.mjs schema Ceremony.CustomAuthenticationInput`.

## Embedded signing

- Set `embeddable_in` to each origin that will frame the ceremony, with its
  scheme: `https://app.example.com`, or `http://127.0.0.1:5173` in
  development. A missing origin fails with a `frame-ancestors` CSP error.
- Append `embedded=true&event_delivery=message` to the ceremony URL. The
  ceremony then posts its result to the parent window with `postMessage`.
  Accept a message only when `event.origin` is
  `https://sign.signatureapi.com` and `event.source` is the ceremony
  iframe's `contentWindow`.
- Treat the event as a UI signal, not proof. Confirm the outcome from your
  server before acting on it (see the mobile section below).
- An embedded ceremony ignores `redirect_url`. The app learns the outcome
  from the posted message and from webhooks.
- For SMS or chat delivery, set `url_variant` to `short`.

## Native mobile apps

Load the ceremony in a WebView. Full guides:
[iOS](https://signatureapi.com/docs/embedded/ios),
[Android](https://signatureapi.com/docs/embedded/android),
[React Native](https://signatureapi.com/docs/embedded/react-native), and
the [overview](https://signatureapi.com/docs/api/guides/how-to/embed-mobile).
A runnable example is the
[demo repository](https://github.com/signatureapi/signatureapi-mobile-integration-demo).
Give the user the link to their platform's guide in your reply.

- Create the ceremony on your server. Use `custom` authentication so the
  API returns `ceremony.url` instead of emailing it. Never call the API
  from the app: a key in an app bundle leaks.
- Prefer a top-level WebView. The ceremony is the WebView's page, so
  `embeddable_in` is not needed. Append
  `embedded=true&event_delivery=redirect` to the URL.
- Leave `redirect_url` unset. Embedded ceremonies ignore it. Set
  `redirect_delay` to `0` when the app shows its own result screen.
  It is a ceremony property that your server sets, not a URL parameter.
  The default is 3 seconds and the maximum is 20.
- Redirect delivery is a client-side navigation to
  `signatureapi-message://<event type>/`. Catch it in
  `WKNavigationDelegate.webView(_:decidePolicyFor:decisionHandler:)` on
  iOS or `WebViewClient.shouldOverrideUrlLoading` on Android. Cancel the
  navigation, then parse the URL. HTTP-layer hooks such as `URLProtocol`
  and `shouldInterceptRequest` never see it.
- In React Native with `react-native-webview`, catch it in
  `onShouldStartLoadWithRequest` and return `false`. Set
  `originWhitelist={['*']}`, or the library hands the URL to the OS and no
  handler sees it. Parse the event URL without `new URL()`. Under Hermes,
  React Native's `URL` returns an empty host for this scheme, so every
  event is lost. See the
  [React Native guide](https://signatureapi.com/docs/embedded/react-native).
- The event type is the URL host. Failures add `error_type` and
  `error_message` as query parameters. Events are `ceremony.completed`,
  `ceremony.canceled`, `ceremony.declined`, and `ceremony.failed`.
- Branch on `error_type`. Treat an unknown value as a generic failure.
  Do not show `error_message` to signers or branch on it. The ceremony
  already shows a translated message. The values are listed at
  [ceremony events](https://signatureapi.com/docs/embedded/ceremony-events#error-types).
- Redirect stays the default. To get a JavaScript message instead, load
  the ceremony top-level with `event_delivery=message`. Set no
  `embeddable_in`. Install a script at document start, in the main frame
  only. It forwards a message to native code only when `event.origin` is
  `https://sign.signatureapi.com` and `event.source === window`. Forward
  only terminal event types, because the page can message itself.
  - On iOS, use a `WKUserScript` at `.atDocumentStart` with
    `forMainFrameOnly: true`, plus a `WKScriptMessageHandler`. In the
    handler, check `message.frameInfo.isMainFrame` and that the sender's
    origin host is `sign.signatureapi.com`.
  - On Android, use `WebViewCompat.addDocumentStartJavaScript` and
    `WebViewCompat.addWebMessageListener`, both allowed for the ceremony
    origin. Check `WebViewFeature` support first. Fall back to redirect
    when either feature is missing.
  - Guides:
    [iOS](https://signatureapi.com/docs/embedded/ios#use-message-delivery-instead)
    and
    [Android](https://signatureapi.com/docs/embedded/android#use-message-delivery-instead).
- Use a local page with an iframe when you share a web SDK page with the
  app. List the page's origin in `embeddable_in`. A synthetic https base
  URL works, such as `https://app.example.invalid`. Use
  `event_delivery=message` in the iframe URL, and check `event.origin` and
  `event.source === iframe.contentWindow`. Forward accepted messages to
  native code with `WKScriptMessageHandler` on iOS or
  `WebViewCompat.addWebMessageListener` on Android.
- Confirm the outcome on your server before acting. Read the envelope
  (`GET /envelopes/{envelopeId}`) or wait for a webhook. See
  [Confirm the outcome on your server](https://signatureapi.com/docs/embedded/ceremony-events#confirm-the-outcome-on-your-server).
- Change no WebView storage settings. The ceremony uses no cookies,
  `localStorage`, `sessionStorage` or IndexedDB. JavaScript must be on.
  Allow these hosts: `sign.signatureapi.com`, `api.signatureapi.com`,
  `vault.signatureapi.com`, `fonts.googleapis.com`, `fonts.gstatic.com`.
  See [browser requirements](https://signatureapi.com/docs/embedded/introduction#browser-requirements).
- Keep the WebView alive across rotation. Recreating it reloads the
  ceremony, and the signer loses their progress. On Android, declare
  `android:configChanges` for orientation and screen size on the
  activity. Do not rely on `WebView.saveState`: it keeps the history,
  not the page, so the ceremony reloads.
- On iOS, reload the same URL in `webViewWebContentProcessDidTerminate`.
  iOS can end the web process while the app is in the background.
- Open links that leave the ceremony in the system browser. On iOS, these
  are navigations whose `targetFrame` is `nil`.
- The ceremony URL is a bearer credential. Do not log it or store it on
  the device. To resume, ask your server for the recipient's current URL.
  A new read of the envelope returns a fresh `standard` URL, and earlier
  URLs work until they expire. Creating a new ceremony revokes them all.
  See [the ceremony URL](https://signatureapi.com/docs/api/resources/ceremonies/ceremony-url#a-new-url-on-every-read).
- A revoked or completed URL still loads with HTTP 200. The page reports
  the failure as `ceremony.failed`. Never check a URL with a plain HTTP
  request.
- UI tests need real input. The ceremony arms completion only after a
  touch, a key press, a scroll-wheel turn, or a pointer moving across
  several positions. Otherwise Finish opens a "Confirm to continue"
  dialog. Use XCUITest taps or UiAutomator gestures. JavaScript clicks
  such as Espresso-Web `webClick()` do not count. Do not confirm the
  dialog: if it appears, the test is not acting like a signer. Assert on
  the delivered event, never on console output. See
  [automated testing](https://signatureapi.com/docs/embedded/introduction#automated-testing).
- Add one UI test that signs through the ceremony with real input. Assert
  on the app's result screen, which only the delivered event triggers.

## Recipients after creation

- Documents, routing and the recipient list are fixed at creation. A
  recipient can be replaced before they sign. Anything else means
  cancelling the envelope and creating a new one.
- A recipient who declines does not cancel the envelope on their own.
  Handle `recipient.rejected`. Replace the recipient or cancel the
  envelope, as the product needs.
- Input places (text inputs, checkboxes, dropdowns, radio groups) need
  `sequential` routing when an envelope has more than one recipient.
- There are no automatic reminders. Build them with the resend endpoint.
  Resend has a cooldown, reported in `can_resend_at`, and a cap per
  recipient.

## Email in live mode

Test mode never sends email. Live mode does, so decide each kind before
going live:

- The invitation: sent when `email_link` is the first authentication
  method. Put `email_code` or `custom` first to deliver the link yourself.
- The signed document: sent to each recipient whose `delivery_type` is
  `email`. Set it to `none` to deliver it yourself.
- Owner notifications: set on the dashboard, not in the API.

A signer with no email address still needs one in the request. Use any
address at `signatureapi-null.com`; nothing is sent to it. An address that
once hard-bounced is blocked: creating an envelope for it fails with a 422
`blocked-email` error. Replace it with a corrected address.

A live key works only once live mode is active on the account, which needs
a subscription. Until then every live call returns 401
`live-mode-disabled`.
