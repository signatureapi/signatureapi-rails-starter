---
name: signatureapi-architecture
description: "Use when someone wants to add e-signatures or SignatureAPI to an app and the signing flow is not decided yet. Decides who signs, how they prove it is them, and what happens after. Also for a signing product or \"a platform like DocuSign\", even when the user knows no SignatureAPI terms. Writes a design brief or document, no code. Needs no API key."
---

# Design a SignatureAPI integration

## Purpose

Understand what the user wants their people to experience. Then decide how
SignatureAPI delivers it. Write a design brief or a design document, sized
to the product, and get an explicit yes. This skill writes no application
code. The `signatureapi-integrate` skill builds from what the user approved.

## When to reach for something else

- **Building against an approved design** belongs to `signatureapi-integrate`.
  It builds from the approved brief or document.
- **Diagnosing an integration that already exists** belongs to
  `signatureapi-diagnose`.
- **Whether SignatureAPI supports something** is answered by
  `signatureapi-docs`. Use it before you tell the user a capability exists
  or does not.
- **A different e-signature vendor** (DocuSign, Dropbox Sign, Adobe Sign, etc.)
  needs that vendor's own docs. Map the user's needs onto SignatureAPI's
  objects, not onto that vendor's.

## Keep the user's vocabulary

Keep the user's words for their product: a "contract", a "client", an
"onboarding step". Their code keeps its names too. Use SignatureAPI terms
only at the API boundary, and record the mapping in the design.

Ask every question in plain words; `references/plain-language-questions.md`
has the plain form of each decision. Tell the user two facts early: test
mode sends no real email, and a signer who is not logged in to the app is
reached by email.

## Understand the experience first

Before reading code and before naming any API object, establish four things
with the user:

- **The journey.** Who starts it, what they see, what the signer sees, and
  what happens after everyone has signed. Ask for the story in their words.
- **The actors.** Who sends, who signs, who approves, who only watches. Which
  of them are the app's own users and which are outsiders.
- **The success condition.** What must be true for the user to call this
  done. A signed PDF in a folder, a status on a record, an email, a
  dashboard entry.
- **The constraints.** Deadline, legal context, existing vendor, volume,
  budget, must-not-change parts of the app.

When the request already says most of this, restate it in one short
paragraph and ask only for what is missing. Ask in the user's words. Do not
ask about authentication methods, place types or routing yet.

Then ask one more question: **quick or thorough?** Offer the choice in one
line. "I can propose one recommended design and you confirm or correct it.
Or we explore alternatives together first." The answer sets the pace of the
rest of the conversation. Quick means: one recommended design, decisions
stated with their evidence, a short confirmation round. Thorough means:
present the alternatives, resolve the decisions in a few grouped rounds.

## Explore the codebase

Now read the code. Each signal below informs one decision and implies one
default. Record what you find; you will cite it as evidence.

- **Document origin.** Grep for PDF generation libraries, upload handlers,
  object storage clients, DOCX or templating code. Informs the document input
  path. Default: the app stores the file in its own storage and passes a
  signed or public URL. `POST /uploads` only when the app has no storage.
- **User authentication and a web frontend.** Grep for session or login
  code, and for a browser UI. Informs recipient authentication and whether
  the ceremony is emailed or embedded. Default: emailed link (`email_link`)
  for people outside the app. Embedded (`custom` plus `embeddable_in`) only
  for signers who are logged in to the app. Either can carry an extra
  challenge as a later array entry without changing who delivers the URL.
- **A native mobile app.** Look for an Xcode project, an Android Gradle
  module, or a React Native app. Informs whether signers sign inside the
  app. Default: a top-level WebView with `custom` authentication, created
  by the app's server (Shape 4 in `references/product-shapes.md`).
- **Tenancy.** Grep for organization, account, or tenant tables. Informs
  `sender` and `topics`. Default: one sender (the account's default) and no
  topics.
- **Webhook routes, queues, domain events.** Grep for existing inbound
  webhook handlers, job queues, event dispatch. Informs how events are
  handled and where envelope creation runs. Default: reuse the existing
  webhook route pattern and the existing background-job path.
- **Where third-party ids are persisted.** Grep for columns or tables that
  hold Stripe, Twilio, or similar ids. Informs where the envelope id goes.
  Default: a column on the domain row that motivated the signature.
- **PDF viewer or canvas components.** Grep for PDF rendering in the
  frontend. Informs whether a place-drawing UI is feasible. Default: no
  drawing UI. Use placeholders or `fixed_positions` set in code.
- **Design records.** Look for an ADR directory (`docs/adr`, `adr/`), a
  design-docs folder, or a decisions log. When one exists, the design
  document goes there, in that convention, with a pointer at the default
  path. An ADR directory counts even though this document is longer than
  one ADR.

The four placement questions in
`../signatureapi-integrate/references/brownfield-placement.md` cover the
call site, the inbound-HTTP path, and the persistence home. Answer them here.
Do not repeat them in the design document; link to the answers.

## Present the possibilities

Match the journey to the closest starting points in
`references/product-shapes.md`. Four common shapes are described there:
send-for-signature inside an existing app, an embedded signing step, a
self-serve platform, and signing inside a native mobile app. They are starting points, not a menu. Many products
combine two, or fit none. Say which shape is closest, what differs, and
what that difference costs. In thorough mode, present two or three
alternatives with their trade-offs. In quick mode, present one and say why.

## Decide progressively

- **Strong signal** in the code or the request: decide, and state the
  evidence.
- **Weak signal:** propose the default and ask for a yes.
- **No signal:** ask.

Always ask, even when you could infer it, when a decision changes what
people experience, the security of the signing, its legal standing, its
cost, or who owns the data. Decide everything else yourself and state it.

Ask in rounds, grouped by dependency: the document and its fields; the
signers and how they authenticate; what happens on completion; tenancy and
rollout. At most four questions per message, one decision each, with your
proposed answer beside it. Stop when the remaining decisions have a strong
signal or a confirmed default.

### Worked example: the first round

> You described this: a customer accepts a quote in your app, then your
> account manager and the customer both sign the order form, and the signed
> PDF goes onto the order. I found a PDF generator and an S3 client, so I
> propose your app generates the order form and uploads it. Two questions
> on the document before we get to the signers:
>
> 1. Does your app generate the order form, or do account managers upload
>    their own files? I propose generated.
> 2. Where should the signature boxes go: marked inside the generated
>    order form where they belong (my proposal), or at fixed spots you set
>    once?

## Decision matrix

The API-facing decisions, one row each. This table is for you; the user
sees the plain form in `references/plain-language-questions.md`. Every
identifier below is in the published spec. Check any you are unsure of before you write it into the
design:

    node ../signatureapi-integrate/scripts/openapi-explore.mjs schema Envelope.EnvelopeInput
    node ../signatureapi-integrate/scripts/openapi-explore.mjs schema Ceremony.CeremonyInput
    node ../signatureapi-integrate/scripts/openapi-explore.mjs schema Recipient.Type
    node ../signatureapi-integrate/scripts/openapi-explore.mjs schema Place.Type

| Decision | Options | Signals that pick one | Consequences | Default |
| --- | --- | --- | --- | --- |
| Document input path | A signed or public URL to a file in the app's own storage on a supported host (`../signatureapi-integrate/references/documents.md`); `POST /uploads` with the file bytes; a DOCX template merged with `data` | Object storage present → store there and pass a signed URL. No storage → `POST /uploads`. DOCX templates present → `format: docx` with `data`. A field-drawing UI → `POST /uploads`, because the structure read needs an upload id | The app keeps its own copy and record of the file. Upload URLs are temporary. DOCX `data` shapes the template fields the app must fill | A signed URL to the app's own storage |
| How places are defined | `[[place_key]]` placeholders in the file; `fixed_positions` in code; DOCX template fields plus places; a UI where users draw fields | App controls the document source → placeholders. Third-party PDF → `fixed_positions`. PDF viewer component present → drawing UI is feasible | A drawing UI needs page rendering, coordinate conversion, and reading the upload's structure (`inspect_upload`). It is the largest part of a platform | Placeholders when the app owns the file; `fixed_positions` otherwise |
| Recipient types and `routing` | The values in the current `Recipient.Type` schema; `routing` `sequential` or `parallel` | Approval step in the domain flow → `approver`. Fields filled before signing → `preparer`. Countersignature by the app owner → `automatic_signer`. A qualified-signature requirement → inspect `qualified_signer` and its account prerequisites | `sequential` notifies one recipient at a time. `parallel` notifies all at once | One `signer`; `sequential` |
| Authentication per recipient | An ordered array of `email_link`, `email_code`, `custom`, `identity_verification`. The first entry is the main method; later entries are extra challenges | Signer is logged in to the app → `custom`. Signer is outside the app → `email_link`. Regulated or high-value document → add a challenge to that main method, e.g. `[email_link, email_code]` for a signer outside the app, `[custom, email_code]` for one inside it | The **first** entry decides who delivers the ceremony URL: `email_link` first returns no URL and SignatureAPI emails the link and any code, so the app sends no email; `email_code` or `custom` first returns the URL for the app to deliver. `custom` is an assertion written to the audit log. `email_link` and `custom` are only valid first and cannot be combined; `email_code` appears at most once; `identity_verification` is never first and is enabled per account | `[email_link]` |
| Ceremony delivery and return | Emailed link; embedded with `embeddable_in`; embedded in a native app's WebView; `redirect_url` after the ceremony | Web frontend and logged-in signer → embedded. iOS or Android app and logged-in signer → native WebView, no `embeddable_in` for a top-level WebView. No frontend → emailed | Embedded ceremonies ignore `redirect_url`; the app learns the outcome from events. A native app catches them in its WebView navigation handler, and its server confirms the outcome. `redirect_url` receives the outcome, the envelope id and the recipient id as query parameters; the names are in the spec's `Ceremony.RedirectUrl` description | Emailed link, no redirect |
| On completion | Fetch deliverables and store them; notify the domain; do nothing beyond marking status | Object storage present → store the signed PDF there. Document model present → attach to it | `standard` deliverable includes the audit log; `simple` does not. `delivery_type: none` stops SignatureAPI emailing the deliverable to the recipient | Mark status on `envelope.completed`. On `deliverable.generated`, fetch `GET /envelopes/{envelopeId}/deliverables`, store the file at once (download URLs expire), mark the domain row |
| Rollout | Test mode only; test then live; who holds the live key | Env file with a `key_test_` key present → test first. Secrets manager present → live key goes there | Test envelopes send no email and are not binding. Live mode needs an active subscription on the account. A live key must never enter this skill's scripts | Test mode first. The user names who holds the live key and confirms live mode is active |
| Senders and multi-tenant | Account default sender; per-customer `sender` after `POST /senders` verification; `topics` per tenant | Tenant table present and customers send in their own name → per-customer sender. Tenant table present and one brand → default sender plus `topics` | A sender needs email verification before use. `topics` filter webhooks and envelope listings | Account default sender |
| Branding logo | No logo; a permanent PNG upload in the same account | A tenant or product logo exists → upload that PNG with `POST /uploads`, then make it permanent with `POST /uploads/{uploadId}/store` and a unique `key`. Or the user uploads it in the Dashboard Library | `branding.logo` accepts only the `url` of a permanent PNG upload in the same account. A website, CDN or signed storage URL is rejected. A temporary upload is rejected. Store the upload once and reuse its `url`; per-tenant logos need one stored upload each | No logo |
| Attestation | `none`, `mx_nom151`, `br_icp_brasil` | Mexican or Brazilian legal context in the domain → the matching value | Both paid options must be enabled at the account level | `none` |
| Envelope email content | Product wording in `title` and `message`; account anti-phishing content capability when the wording contains URL-, phone-, or numeric-date-like text | Required product copy contains any restricted pattern → record account enablement as a prerequisite | A stricter account policy can reject content that is valid under the JSON schema. Do not silently rewrite required copy | Plain text without restricted patterns for generic fixtures |

## Make scope explicit

For a design document, add a capability coverage table. Read the current
`Recipient.Type` and `Place.Type` schemas and give each value one line:
included now, or deferred with a reason. The first version's scope is not
the limit of SignatureAPI. Re-read the schemas when revising an old design.

## Cover the whole product, not only the API

For a design document, walk `references/coverage-checklist.md` once:
ownership, drafts and templates, tenant isolation, retention, repair paths,
volume, accessibility, non-goals. Take what this product needs. It is a
checklist for you, not a questionnaire; most items resolve from the journey
and the code.

## Brief or document

Match the output to the size of the product.

- **One signing flow** (a document, its signers, what happens after) → a
  design brief in chat. Write no file. Start with the journey in one
  sentence. Then give one plain line for each of these:
  - where the document comes from
  - who signs, in what order
  - how a signer proves it is them
  - where they sign
  - what happens when everyone has signed
  - trying it in test mode first

  Take the wording from `references/plain-language-questions.md`.
  Ask for an explicit yes. Then hand over to `signatureapi-integrate`.
- **A platform-shaped product** (users send their own documents, draw
  their own fields, or send in their own name; many tenants; "a platform
  like X") → the design document below.
- **The user asks for a document**, or the repository keeps design
  records for features like this → the design document below.

## Write the design document

Write it once the journey is confirmed, the shape is chosen, and every
decision that changes the data model, authentication or who receives email
has a yes.

Put it where the repository keeps design records (an ADR directory, a
design-docs folder), in that convention, with a one-line pointer at
`docs/signatureapi-integration.md`. Otherwise write it at that path.

Keep the template's headings. Delete a section only with a reason in Open
items. **For you** lines are the user's words, and the user approves them.
**Technical decision** lines are yours.

```markdown
# <the user's name for this feature> — SignatureAPI integration design

Date: YYYY-MM-DD
Status: draft | approved
Starting point: <closest shape from references/product-shapes.md, or "custom">
Departures from it: <one line each, or "none">

## The experience

- Journey:
- Actors:
- Success condition:
- Constraints:
- Non-goals:

## Vocabulary

| The user's term | Means, at the API boundary |
| --- | --- |
| <their term> | <envelope / recipient / place / ceremony / deliverable, and how> |

## Decisions

### Where the document comes from
- For you: <plain sentence, e.g. "Ledgerly makes the letter itself">
- Technical decision:
- Evidence or answer:
- Consequence:

### Where the signature and other fields go
- For you: <plain sentence>
- Technical decision:
- Evidence or answer:
- Consequence:

### Who takes part, and in what order
- For you: <plain sentence>
- Technical decision:
- Evidence or answer:
- Consequence:

### How a signer proves it is them
- For you: <plain sentence, one per kind of signer>
- Technical decision:
- Evidence or answer:
- Consequence:

### Where they sign, and where they land afterwards
- For you: <plain sentence>
- Technical decision:
- Evidence or answer:
- Consequence:

### What happens when everyone has signed
- For you: <plain sentence: where the signed file goes, who gets a copy by email>
- Technical decision:
- Evidence or answer:
- Consequence:

### Trying it safely, then going live
- For you: <plain sentence: test mode sends no real email; who holds the live key>
- Technical decision:
- Evidence or answer:
- Consequence:

### Whose name is on the email
- For you: <plain sentence>
- Technical decision:
- Evidence or answer:
- Consequence:

### Legal timestamp for Mexico or Brazil
- For you: <plain sentence, or "not needed">
- Technical decision:
- Evidence or answer:
- Consequence:

## Product coverage

<one short entry per applicable area from references/coverage-checklist.md:
ownership and permissions; drafts and templates; tenant isolation; sensitive
data and retention; idempotency, reconciliation and repair; volume and
observability; accessibility, mobile, localization, branding>

## SignatureAPI capability coverage

| Area | Provider capability | Included now? | If deferred, why |
| --- | --- | --- | --- |
| Recipient type | <one current `Recipient.Type` value> | yes / no | <reason or n/a> |
| Place type | <one current `Place.Type` value, or a group with one disposition> | yes / no | <reason or n/a> |

## Account prerequisites

- <account capability needed by an approved decision, including restricted
  `title` or `message` content; or "none">

## Endpoint sequence the application calls

1. <method and path, and where in the codebase it is called from>

## Events the application handles

- <event type> — <what the handler does>

## What the application persists

- <field or table> — <what it holds>

## Open items

- <anything still unanswered>
```

Present the document to the user. Ask for an explicit yes on The
experience section and the For you lines; read them out, not the technical
lines. Set `Status: approved` only after the user says yes. The file is the contract
`signatureapi-integrate` reads. Do not start building.

## Red flags

| Thought | Reality |
| --- | --- |
| "I'll read the code first, then ask." | The code says where signing fits, not what people should experience. Ask that first. |
| "This is obvious, I'll skip the design." | Document source, field placement and completion handling are where a wrong guess costs days. A brief takes one message. |
| "Every flow needs the full document." | One signing flow needs a brief. The document is for platform-shaped products, or on request. |
| "They said 'like X', so I'll copy X's data model." | X's templates, drafts and tabs are not SignatureAPI's objects. Map the user's needs onto this API. |
| "I'll pick sensible defaults and note them." | `custom` authentication, a placeholder scheme and where the PDF is stored are product decisions. Propose them and get a yes. |

## References

- `references/product-shapes.md` — four common starting points: what the app calls, what you prove it with
- `references/plain-language-questions.md` — each decision as a plain question, with the technical meaning of each answer
- `references/coverage-checklist.md` — the product-design areas beyond API configuration
- `../signatureapi-integrate/references/brownfield-placement.md` — where signing belongs in an existing codebase
- `../signatureapi-integrate/references/verification-loop.md` — why `custom` authentication is only for signers the app verified

## Vocabulary

An **envelope** holds **documents** and **recipients**. **Places** are
regions on a document bound to a recipient. Each recipient signs through a
**ceremony**. Completion produces a **deliverable**. The **design
document** is `docs/signatureapi-integration.md`.
