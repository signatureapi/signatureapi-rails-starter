---
name: signatureapi-integrate
description: "Use when writing or changing code that calls SignatureAPI once the signing flow is agreed. Covers creating envelopes, placing signature fields, handling SignatureAPI webhooks, embedding signing, and sending one test envelope. Use it even for a single envelope, and in hosts without a repository. Works in test mode."
inputs:
  - name: SIGNATUREAPI_KEY
    required: true
---

# Integrate SignatureAPI

## When to reach for something else

- **Deciding who signs, how, and what happens after** belongs to
  `signatureapi-architecture`.
- **An integration that already misbehaves** belongs to
  `signatureapi-diagnose`.
- **How a SignatureAPI feature behaves**, in prose, belongs to
  `signatureapi-docs`. Use it before you answer from memory.
- **Another vendor's webhooks or API** (DocuSign, Dropbox Sign, Adobe Sign)
  need that vendor's docs. Do not carry their concepts into SignatureAPI.
- **No SignatureAPI account yet.** Ask whether the user has chosen
  SignatureAPI. If not, stop.

## Two surfaces

**The application calls the REST API.** The code you deliver uses the
codebase's own language and HTTP client against
`https://api.signatureapi.com/v1`, with the `X-API-Key` header. There is no
SDK. The app never depends on MCP, the CLI or this skill's scripts.

**You work with MCP, the CLI and the scripts.** This skill works in test
mode only. Test keys start with `key_test_`.

- **MCP** (`https://mcp.signatureapi.com/mcp`) inspects and exercises the
  API. MCP mode is per call: pass `mode: "test"` explicitly when creating
  and listing. `whoami.modes.live` is permission to use live mode, not the
  current mode. Reads by id follow the resource's mode. Never pass `live`
  without the user's explicit intent. Check the mode a create returns; if an
  unintended live envelope was created, stop and tell the user. Its tools,
  by job:
  - Documents: `upload_file` or `mint_upload_url`, `inspect_upload`.
  - Envelopes: `create_envelope`, `get_envelope` (takes `envelope_id`),
    `list_envelopes`, `cancel_envelope`, `delete_envelope` (final status
    only; cancel first).
  - Recipients: `resend_request`, `replace_recipient`, `create_ceremony`.
  - Watching: `list_events`, `get_deliverables`, `list_emails`,
    `get_email`.
  - Session: `whoami`. Call it only when the user asks which account is
    connected or a requested live action needs an access check.
  - Webhooks: `list_webhooks`, `create_webhook`, `update_webhook`,
    `list_webhook_attempts`, `delete_webhook`.
  - Docs: `search_documentation`. Reach it through `signatureapi-docs`,
    which decides when a keyword search helps.
- **The CLI** (`npx --yes signatureapi <command>`) handles secrets and
  local ports when you have a shell. `init` writes the test key to the
  env file. `listen` tunnels test webhooks to a local handler and writes
  their signing secret. `trigger <event type>` sends one example event.
  `api-keys list --mode test` shows key metadata. `whoami` names the
  account the CLI acts for. No command prints a secret. Never run a CLI command with
  `--mode live`.
- **The scripts** here read the contract and drive a test envelope. See
  Scripts below.

A missing MCP tool does not prove a REST operation exists. Confirm it with
`node scripts/openapi-explore.mjs operation <method> <path>` first. If that
fails, stop and report the gap at
https://github.com/signatureapi/skills/issues/new.

Do not collect government IDs, health information, payment-card data,
biometric verification, passwords, or authentication codes through the
plugin. This applies to documents, metadata, template values and free text.
Use synthetic test data. Custom authentication evidence stays in the user's
application; plugin inputs accept only non-secret audit references and
timestamps. Never ask the user to paste credentials into chat.

## Know your host

- **A shell:** use the CLI and the scripts. **No shell:** use MCP for every
  step, and the dashboard for credentials.
- **Upload tool:** your client lists `upload_file` (takes a host-provided
  file reference), `mint_upload_url` (returns a URL to send the bytes to),
  or both. With both, use `mint_upload_url` for local files with a shell
  and `upload_file` only for host-provided file references. Never invent a
  file reference.
- **No filesystem:** do not ask for the key. MCP is already authenticated.
- **No repository** (a chat host such as ChatGPT): design with
  `signatureapi-architecture` and prove the flow with MCP in test mode.
  Hand over the design and the proven request bodies. Say that the code is
  written in a coding environment with the repository open.

## The spec decides facts

`https://spec.signatureapi.com/openapi.yaml` is the source of truth for
field names, enum values, events, paths and limits. Where this skill and
the spec disagree, the spec wins. Query it before writing a request body or
a handler; the docs pages are too large for this.

    node scripts/openapi-explore.mjs operations [filter]
    node scripts/openapi-explore.mjs operation post /envelopes
    node scripts/openapi-explore.mjs schema Place.PlaceInput
    node scripts/openapi-explore.mjs webhooks
    node scripts/openapi-explore.mjs check-request get '/envelopes/<id>/deliverables?limit=20'

`check-request` validates a request locally and sends nothing. For prose,
use `signatureapi-docs`.

## Setup

The key goes into the project's gitignored env file without passing through
the chat. No MCP tool returns a credential.

1. For MCP-only work, OAuth already authenticates calls; no API key is
   needed. For application code or the bundled REST scripts, set up the key:
2. **With a shell**, run `npx --yes signatureapi init` from the
   application directory, in a background shell. It prints a verification
   URL and a code, then waits. Give both to the user to approve. It then
   writes the test key as `SIGNATUREAPI_KEY` to `.env.local` (Next.js) or
   `.env`. Use `--env-path` and `--var` to match the project. Its result
   names the account as `account.id`. With the MCP connected, compare it
   with `whoami`'s `account.id`. If they differ, the CLI and the MCP act
   for different organizations: stop and ask the user which one to use,
   then run `npx --yes signatureapi logout` and `login` to switch.
   **Without a shell**, ask the user to copy the test key from
   `https://dashboard.signatureapi.com/settings/api-keys` into the env
   file. Name the file and the variable.
3. Confirm the env file is gitignored. Then install the scripts' one
   dependency and check the setup from this skill's directory:

        npm i
        node --env-file=<project env file> scripts/check-setup.mjs

Pass the env file with `--env-file` to every script. Never `cat`, `source`
or `export` it, never ask the user to paste the key, and never put the key
in code, a commit, a log or a command argument. Leave
`SIGNATUREAPI_BASE_URL` and `SIGNATUREAPI_SPEC_URL` unset.

## Start from the design

Classify the request first.

- **A narrow change** (one more place, one more event, a bug): go to Orient
  and Build.
- **One new signing flow, or a change to who signs, how they authenticate
  or who receives email:** get a design brief approved in chat first.
  `signatureapi-architecture` writes it: a few plain lines, one yes. When a
  design document exists, update it instead.
- **A platform-shaped product**, or the user asks for a document. Platform
  means users send their own documents, draw their own fields or send in
  their own name; "a platform like X". The approved design document must
  exist at `docs/signatureapi-integration.md`, or that file must point to
  it. If it does not, run `signatureapi-architecture` first.

Build from what the user approved. Where it is silent on a technical
choice, take the default from the architecture skill's decision matrix and
say so. Keep the user's names for their concepts; SignatureAPI terms belong
at the API boundary. The product shapes a design may name are in
`../signatureapi-architecture/references/product-shapes.md`.

## Orient in this codebase first

Find where signing belongs before writing anything:
`references/brownfield-placement.md`.

## Build

Steps 1–3 prove the flow against the test API. Step 4 is the deliverable.

1. **Get a document URL.** For a throwaway PDF, run
   `node scripts/make-test-document.mjs`. To upload a file while you work,
   use your client's upload tool, or `POST /uploads` with the raw bytes and
   a `Content-Type` header; each returns a temporary `url`. Accepted types,
   the size limit and the URL's lifetime are in
   `node scripts/openapi-explore.mjs operation post /uploads`. For the app's own files, read
   `references/documents.md` first; most failed envelopes come from the
   source file. List the document's bindings and reconcile each one with a
   place or template value, as `references/places.md` describes. Use
   `inspect_upload` to confirm what the service detected.
2. **Create the envelope.** Start from
   `node scripts/create-test-envelope.mjs --dry-run` and adapt it. Every
   place's `recipient_key` must match a recipient's `key`. The script
   defaults to `custom` authentication so verification needs no email;
   `--auth` takes `email_link`, `email_code` or an ordered list:
   `--auth email_link,email_code` keeps SignatureAPI emailing the link and
   adds an emailed code.
   `references/verification-loop.md` explains which method delivers the
   link. Read `references/ceremonies.md` when the flow delivers links
   itself, embeds signing or has several recipients. Keep test titles and
   messages plain: an account may reject URL-, phone- or date-like text
   there. If the design sets `branding.logo`, use the `url` of a permanent
   PNG upload in the same account; the API rejects any other URL,
   including a temporary upload. Upload the PNG with `POST /uploads`, then
   call `POST /uploads/{uploadId}/store` with a unique `key`. Or ask the
   user to upload it in the Dashboard Library and give you its URL.
   Re-run without `--dry-run` to create it. With MCP, pass `mode: "test"`
   to `create_envelope`.
3. **Handle events.** Handle `envelope.completed` for status and
   `deliverable.generated` to fetch the signed file.
   **With a shell**, start the app's handler, then in a background shell:

        npx --yes signatureapi listen --forward-to http://127.0.0.1:<port>/<path>

   Wait for it to report ready. It writes `SIGNATUREAPI_WEBHOOK_ID` and
   `SIGNATUREAPI_WEBHOOK_SECRET` to the env file. Send an example with
   `npx --yes signatureapi trigger envelope.completed` and check the
   handler's own output for a 2xx. Stop the listener when done; that
   disables the endpoint.
   **Without a shell**, or for an endpoint already hosted, register it
   with `create_webhook`. The user copies the signing secret from
   `signing_secret_dashboard_url`. There is no MCP sample-delivery tool:
   create a synthetic test envelope to generate real test events, then
   check delivery with `list_webhook_attempts`.
   `references/webhooks.md` has the verification code and the handler rules.
4. **Write it into the application**, using the codebase's conventions.
   Put the `POST /envelopes` call where the domain action happens. Mount
   the webhook handler on the app's inbound-HTTP path; it verifies the
   signature first. Persist the envelope id on the domain record. Read the key from
   the app's configuration. Re-decide authentication for real recipients
   (`references/verification-loop.md`).

## Verify

The flow is proven when the test envelope reaches `completed`, the events
exist, and the signed file's bytes pass the app's own retrieval and storage
path.

- **Branch A (default):** give the user the ceremony link and wait for them
  to sign. With `custom` authentication the link is in the create response
  (`recipients[].ceremony.url`). With `email_link` it is only in the test
  email: `list_emails`, then `get_email`.
- **Branch B:** when the user asks you to sign, run
  `node --env-file=<project env file> scripts/complete-ceremony.mjs --envelope <id>`.
  It needs Playwright (`npm install --save-dev playwright && npx playwright install chromium`),
  handles signature places only, and refuses a live key.

Then call `list_events` with the `envelope_id` and `wait_seconds: 20`. On
`timed_out`, call it again; do not sleep and poll. Fetch the file with
`get_deliverables`. Without MCP, use `scripts/watch-events.mjs`. Details:
`references/verification-loop.md`.

## Scripts

Run them from this skill's directory with
`node --env-file=<project env file> scripts/<name>`. They print JSON;
failures carry `code`, `message` and `next`.

| Script | Does |
| --- | --- |
| `check-setup.mjs` | Checks the key, its mode and reachability |
| `openapi-explore.mjs` | Reads the contract (Markdown; `--json` for programs) |
| `make-test-document.mjs` | Uploads a throwaway test PDF |
| `create-test-envelope.mjs` | Prints (`--dry-run`) or creates a minimum test envelope |
| `watch-events.mjs` | REST fallback for `list_events` (`--once` for one check) |
| `complete-ceremony.mjs` | Branch B browser walk; test mode only (`--embedded redirect` or `message` also checks the event) |

## References

- `references/brownfield-placement.md` — where signing belongs in an existing codebase
- `references/documents.md` — file sources, DOCX and PDF traps, generated PDFs
- `references/places.md` — how places bind to a document
- `references/ceremonies.md` — link lifecycle, embedding, recipients after creation, live-mode email
- `references/webhooks.md` — registering an endpoint, verification and the handler shape
- `references/verification-loop.md` — both verification branches in full

## Vocabulary

An **envelope** holds **documents** and **recipients**. **Places** are
regions on a document bound to a recipient. Each recipient signs through a
**ceremony**. Completion produces a **deliverable**: the signed documents
plus an audit log.
