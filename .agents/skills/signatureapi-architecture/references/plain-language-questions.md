# Plain-language questions

*Reference for the SignatureAPI signatureapi-architecture skill. One entry
per row of the decision matrix: the question in the user's terms, the
answers in plain words, and the technical decision each answer maps to.
Full workflow: SKILL.md.*

The user never has to know a SignatureAPI term to answer. Ask the plain
question. Keep the mapping to yourself and write it into the technical line
of the design document. Substitute the user's own words for "document",
"signer" and "your app".

Ask a question only when the answer changes what people experience, the
security of the signing, its legal standing, its cost, or who owns the
data. Otherwise decide from the code and state the decision.

## Where does the document come from?

- "Your app makes it" → the app generates the file, stores it in its own
  storage, and passes a signed or public URL to that copy. Preferred: the
  app keeps its own record of the file.
- "Someone uploads a file" → the app stores the user's file in its own
  storage and passes a signed or public URL. Same preference.
- "A Word template we fill in" → `format: docx` with `data`, from a URL the
  app hosts.
- "It is already online at a link" → the app passes that URL.
- Only when the app has no storage of its own, or needs the page structure
  read before placing fields: `POST /uploads` with the bytes, then the
  returned temporary `url`.

Usually decided from the code. Ask only when the code shows no document
source.

## Where do the signature and the other fields go?

- "We mark the spots inside the document" → `[[place_key]]` placeholders
  written into the file.
- "Fixed spots we set once" → `fixed_positions` in code, checked with
  `inspect_upload`.
- "Our users drag fields onto the pages themselves" → a drawing UI: page
  rendering, coordinate conversion, `inspect_upload`. The largest build.

Ask only when the drawing UI is a possibility, because of its cost.
Otherwise decide from who controls the document.

## Who takes part, and in what order?

- "Only the person signing" → one `signer`.
- "Someone must approve it before it is signed" → an `approver` first.
- "Someone fills in details before the signer sees it" → a `preparer`
  first, or the app fills the document before it exists.
- "Our own signature is added automatically" → an `automatic_signer` with a
  `mandate`.
- "One after another" → `routing: sequential`. "Everyone at once" →
  `routing: parallel`.

Ask when the journey leaves the order or the participants open.

## How does a signer prove it is them?

- "The link in their email is enough" → `email_link`.
- "They also type a code we email them" → `email_code`.
- "They show an ID" → `identity_verification`; paid, enabled per account.
- "They are already logged in to our app" → `custom`, with the app's own
  login as the proof, embedded in the app's page.

Always ask, once per kind of signer. It is a security decision. Say in
plain words what each option costs the signer: one click, one code, an ID
check.

## Where do they sign, and where do they land afterwards?

- "From the email, on a page we do not host" → emailed link, standalone
  ceremony.
- "Inside a page of our app" → embedded with `embeddable_in`, only for
  logged-in signers.
- "Send them back to our site when they are done" → `redirect_url`, with the
  outcome and ids as query parameters.
- "Inside our iPhone or Android app" → native embedding (Shape 4 in
  `product-shapes.md`). The app's server creates the ceremony with
  `custom` authentication. The app loads it in a WebView and catches the
  result. No `redirect_url`. Only for signers logged in to the app.

The codebase may have an iOS or Android app, or the journey may mention a
phone. Then ask first: "Do your signers use your iPhone or Android app to
sign?" For a yes, ask one follow-up:

- "When they finish, should your app show its own screen right away?" Yes
  → `redirect_delay` of `0`. No → the signing page shows its result for a
  few seconds first.

Ask when the app has a web or mobile frontend; it changes what the signer
sees.

## When everyone has signed, what should happen?

- "Store the signed document with the record" → handle
  `deliverable.generated`, fetch the deliverables, store the file, mark the
  domain row.
- "Email every signer their copy" (or not) → `delivery_type: email` or
  `none` per recipient.
- "Include the signing history pages" (or a clean copy) → `standard` or
  `simple` deliverable.

Ask about the copy emails and where the file lives: they are what people
see and who owns the data. Decide the event handling from the code.

## Try it safely first, then go live

- "Test it without emailing anyone" → test mode. Say plainly: test mode
  sends no real email and signed documents are not binding.
- "Go live" → a live key, held where the app keeps secrets. Ask who holds
  it.

Always state the test-first plan. Ask only who holds the live key.

## Whose name is on the email the signer receives?

- "Ours" → the account's default sender.
- "Each of our customers' own name" → a `sender` per customer, verified by
  email once, plus `topics` per customer for filtering.

Ask when the app has tenants. It changes what signers see and adds a
verification step per customer.

## Do you need a legally recognized timestamp for Mexico or Brazil?

- "No" or no such market → `attestation: none`.
- "Yes, Mexico" → `mx_nom151`. "Yes, Brazil" → `br_icp_brasil`. Both paid,
  enabled per account.

Ask only when the domain suggests those markets. Otherwise decide `none`
and state it.
