# Placing signing in an existing codebase

*Reference for the SignatureAPI signatureapi-integrate skill. Test-mode
integration context, not production guidance on its own. Full workflow:
SKILL.md.*

In a greenfield project there is nothing yet to place signing into. Skip
ahead to Build in SKILL.md. These questions apply once there is an existing
codebase to fit into.

Answer these before writing code:

1. Where do documents already live? Grep for PDF generation, file uploads,
   S3/blob storage. The signing document usually comes from there.
2. What already happens at the moment a signature would be requested? An
   order confirmed, an offer accepted, a contract finalized. That is the
   call site.
3. How does this codebase receive inbound HTTP already? Signature events
   arrive the same way. Look for the existing webhook/route registration
   pattern, not a new one.
4. Where do long-running external states get persisted? An envelope id needs
   a home: a column on the domain row, or an existing side-table for
   third-party references.

Also grep for job queues or domain-event dispatch. If the codebase has one,
creating the envelope may belong there rather than inline.

## Two mistakes to avoid

- **Calling `POST /envelopes` synchronously in a request handler the user is
  waiting on.** The domain action (for example "confirm order") should
  complete on its own. Kick off the envelope creation the way this codebase
  already runs side effects that must not block the response. The
  application calls the REST API directly. The MCP tool of the same purpose
  is yours, not the app's.
- **Not persisting the envelope id.** Without it, nothing can look the
  envelope up again when a webhook or poll reports its status.
