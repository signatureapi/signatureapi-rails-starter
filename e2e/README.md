# End-to-end test

One real run against SignatureAPI **test mode**, driven by [Playwright](https://playwright.dev) in Chromium. Nothing is mocked.

1. Fills in the form and selects **Send for signature**. The app uploads the sample PDF and creates the envelope.
2. Opens a signing ceremony for that envelope and signs it. The app sends with `email_link`, and test mode sends no email, so the test creates a `custom` ceremony through the API in its place ([`support/signatureapi.ts`](support/signatureapi.ts)).
3. Waits for the app's webhook handler to mark the agreement **Completed**, then downloads the signed PDF through the app.

## Run

Needs the app's test key and webhook secret in its env file (see the main README), and webhooks forwarded to the app. In one terminal, from the repo root:

```bash
npx --yes signatureapi listen --forward-to http://127.0.0.1:3000/webhooks/signatureapi
```

In another:

```bash
cd e2e
npm install
npm run install-browsers
npm test
```

The suite starts the app itself ([`app.config.ts`](app.config.ts)), or reuses one already running on the port.

## Record the README video

```bash
npm run record
```

Set `E2E_PORT` to run the app on another port when 3000 is taken (forward `signatureapi listen` there too).

Runs the same test with video on and writes `docs/media/demo.mp4` and `docs/media/demo.gif`. Needs `ffmpeg`.
