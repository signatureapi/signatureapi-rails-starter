#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. Prints (--dry-run)
// or creates a minimum viable test-mode envelope, for adapting into your
// own create_envelope call. Test-mode tooling, not production code. Full
// workflow: SKILL.md.
import { ok, fail, apiBase, requireTestKey } from "./lib/output.mjs";

const API = apiBase();

export const AUTH_TYPES = ["custom", "email_code", "email_link"];

// `authentication` is an ordered array: the first entry is the main method and
// decides who delivers the ceremony URL; later entries are extra challenges.
// Mirrors the API's own rules so a bad combination fails here, not on the wire.
export function parseAuth(value) {
  const types = String(value)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!types.length) return { error: "--auth cannot be empty." };
  const unknown = types.find((t) => !AUTH_TYPES.includes(t));
  if (unknown) return { error: `--auth accepts ${AUTH_TYPES.join(", ")}, got "${unknown}".` };
  if (types.length > 5) return { error: "A ceremony supports at most 5 authentication methods." };
  const firstOnly = types.slice(1).find((t) => t === "email_link" || t === "custom");
  if (firstOnly) return { error: `"${firstOnly}" can only be the first authentication method.` };
  if (types.includes("email_link") && types.includes("custom")) {
    return { error: '"email_link" and "custom" cannot be combined.' };
  }
  if (types.filter((t) => t === "email_code").length > 1) {
    return { error: '"email_code" can appear at most once.' };
  }
  return { types };
}

function authenticationEntry(type) {
  if (type !== "custom") return { type };
  return {
    type: "custom",
    provider: "No identity verification performed",
    data: {
      Warning:
        "Test-mode envelope created by the signatureapi-integrate skill to verify an integration end to end. No recipient identity check was performed.",
    },
  };
}

export function buildEnvelope({ title, documentUrl, recipientName, recipientEmail, auth = "custom" }) {
  const recipient = { type: "signer", key: "signer", name: recipientName, email: recipientEmail };
  const types = Array.isArray(auth) ? auth : (parseAuth(auth).types ?? []);
  // A lone `email_link` is the API's own default, so the minimum viable body
  // omits `ceremony` entirely. Any other combination is stated explicitly.
  if (types.length && !(types.length === 1 && types[0] === "email_link")) {
    recipient.ceremony = { authentication: types.map(authenticationEntry) };
  }
  return {
    title,
    documents: [
      {
        format: "pdf",
        url: documentUrl,
        places: [{ key: "signer_signature", type: "signature", recipient_key: "signer" }],
      },
    ],
    recipients: [recipient],
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = requireTestKey(process.env.SIGNATUREAPI_KEY);
  const documentUrl = arg("document-url");
  if (!documentUrl) {
    fail("MISSING_DOCUMENT_URL", "A publicly reachable PDF URL is required.", [
      "Call the MCP tool mint_upload_url to upload a local PDF and get a URL",
      "node scripts/create-test-envelope.mjs --document-url https://example.com/agreement.pdf",
    ]);
  }
  const parsed = parseAuth(arg("auth", "custom"));
  if (parsed.error) {
    fail("INVALID_AUTH", parsed.error, [
      "node scripts/create-test-envelope.mjs --document-url <url> --auth email_link",
      "node scripts/create-test-envelope.mjs --document-url <url> --auth email_link,email_code",
    ]);
  }
  const auth = parsed.types;
  const body = buildEnvelope({
    title: arg("title", "Test agreement"),
    documentUrl,
    recipientName: arg("recipient-name", "Test Signer"),
    recipientEmail: arg("recipient-email", "test-signer@example.com"),
    auth,
  });

  if (process.argv.includes("--dry-run")) {
    ok({ dry_run: true, body });
  }

  const res = await fetch(`${API}/envelopes`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);

  if (res.status === 422) {
    fail("ENVELOPE_VALIDATION_FAILED", payload?.detail ?? "The envelope body was rejected.", [
      "node scripts/openapi-explore.mjs schema Envelope",
      "Check that every place's recipient_key matches a recipient key",
    ]);
  }
  if (!res.ok) {
    fail("ENVELOPE_CREATE_FAILED", `HTTP ${res.status}: ${payload?.detail ?? "unknown error"}`, [
      "node scripts/check-setup.mjs",
    ]);
  }

  const ceremonyUrl = payload.recipients?.[0]?.ceremony?.url ?? null;

  ok({
    envelope_id: payload.id,
    status: payload.status,
    ceremony_url: ceremonyUrl,
    next: ceremonyUrl
      ? [`node scripts/watch-events.mjs --envelope ${payload.id}`]
      : [
          "ceremony_url is null (expected for --auth email_link) — read it from the email instead:",
          "MCP: list_emails with envelope_id to find the request email, then get_email for ceremony_url",
          `node scripts/watch-events.mjs --envelope ${payload.id}`,
        ],
  });
}
