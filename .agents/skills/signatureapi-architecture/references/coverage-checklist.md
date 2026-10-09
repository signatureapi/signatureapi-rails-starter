# Coverage checklist

*Reference for the SignatureAPI signatureapi-architecture skill. A list of
product-design areas to walk once before writing the design document. Take
what the product needs. It is a checklist for you, not a questionnaire for
the user. Full workflow: SKILL.md.*

Most items resolve from the journey the user described and from the code.
Ask only when an item changes the data model, the authentication, who
receives email, or what the user would call done.

## Goal, actors, ownership

- What the user is trying to achieve, in their words.
- Who can start a signing, who can see its status, who can cancel it.
- Who owns the signed document afterwards, and who may download it.
- Which actors are the app's own users, and which are outsiders.

## Drafts, templates, and who sends

- Whether documents are prepared ahead of time and sent later.
- Whether the app keeps reusable templates. An envelope is created complete
  and is immutable except for `label`. Drafts and templates are the app's
  own data, turned into an envelope at send time.
- Who initiates sending: a person clicking, or a system event.

## API capability scope and account prerequisites

- Inspect the current `Recipient.Type` and `Place.Type` schemas. In the design,
  distinguish every provider-supported type from the subset included in this
  product version. Give each deferred type a reason; do not turn examples or
  defaults into provider limits.
- Record account capabilities required by the approved experience. In
  particular, anti-phishing content policy may reject URL-, phone-, or
  numeric-date-like text in both the envelope `title` and `message`, even when
  the JSON schema accepts the strings. If the product requires that content,
  account enablement is a prerequisite; do not silently rewrite it.

## Authorization and tenant isolation

- How the app decides that a user may act on a given signing.
- In a multi-tenant app: how one tenant's envelopes stay invisible to
  another. `metadata` and `topics` carry the tenant id; the app enforces the
  boundary on every read.
- Whether each tenant sends under its own verified `sender`.

## Sensitive data and retention

- What personal data enters the documents and the recipient records.
- How long the app keeps the signed PDF and the audit log, and where.
- Whether a deliverable needs a `password`, and who holds it.
- What happens on a deletion request.

## Idempotency, reconciliation, retries, repair

- How the app avoids creating two envelopes for one domain action.
- How it recovers when a webhook is missed: a periodic read of the
  envelope, or a reconciliation job over open signings.
- The repair paths the app exposes: resend the request, replace a
  recipient, issue a new ceremony, cancel.

## Volume, rate limits, observability

- Expected envelopes per day, and peaks.
- Where a failed create or a failed webhook handler is logged, and who is
  alerted.
- How support answers "what happened to this signing" without an engineer.

## Accessibility, mobile, localization, branding

- Whether signers use phones. The ceremony works on mobile; the app's own
  pages around it must too.
- Which languages the ceremony and emails need (`language`).
- Logo, accent color and email footer (`branding`), and whether tenants get
  their own.
- Where each logo comes from. `branding.logo` takes only the `url` of a
  permanent PNG upload in the same account, never an external image URL.

## Non-goals and scope

- What this design deliberately leaves out, written down so nobody builds
  it by accident.
