# AGENTS.md

This repo is the SignatureAPI Rails starter: a Rails 8 app that sends a PDF
for e-signature through the SignatureAPI REST API and tracks it with webhooks.
It is a template. Keep changes small and idiomatic Rails.

## Run and test

```bash
bin/setup --skip-server          # gems + SQLite database
bin/rails server -p 3000         # needs SIGNATUREAPI_KEY in .env
bin/rails test                   # unit tests, HTTP stubbed with WebMock
bin/rubocop                      # lint (rubocop-rails-omakase)
cd e2e && npm install && npm run typecheck
```

`npx --yes signatureapi init` writes `SIGNATUREAPI_KEY` to `.env`.
`npx --yes signatureapi listen --forward-to http://127.0.0.1:3000/webhooks/signatureapi`
writes `SIGNATUREAPI_WEBHOOK_SECRET` and forwards test webhooks. The e2e test
in `e2e/` is a real test-mode run and needs both; it is not part of CI.

## Where things live

- `app/services/signature_api.rb`: the only SignatureAPI client
  (`upload_document`, `create_envelope`, `list_deliverables`).
- `app/controllers/signatureapi_webhooks_controller.rb`: the webhook
  receiver and the event-to-status map.
- `app/controllers/agreements_controller.rb`: the form, sending and the
  signed PDF redirect.
- `app/models/agreement.rb`: the domain model.

## SignatureAPI rules

- `https://spec.signatureapi.com/openapi.yaml` is the source of truth for
  fields, enums, paths and events. Check it before changing a request body.
  There is no SDK; call the REST API with `Net::HTTP` and `X-API-Key`.
- Verify every webhook with the Standard Webhooks library over the raw body
  (`request.raw_post`) and the `webhook-id`, `webhook-timestamp` and
  `webhook-signature` headers. A failed check returns 401 and does nothing
  else. Never hand-roll the HMAC.
- Events carry ids only. Find the agreement by `data.envelope_id`.
- Use test keys (`key_test_...`) only. Never commit `.env`.

## SignatureAPI skills

`.agents/skills/` holds the SignatureAPI agent skills (integrate, architecture,
diagnose, docs). Claude Code gets the same skills plus the SignatureAPI MCP
server from the plugin pinned in `.claude/settings.json`. Bump the pin with
`scripts/update-agent-skills.sh <commit-sha>`.
