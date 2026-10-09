#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-diagnose skill. Fetches an
// envelope and its events in one pass and prints a verdict with next
// steps. Read-only diagnostic tooling (works against either a test or a
// live key, GET requests only), not production code. Full runbook:
// SKILL.md.
import { ok, fail, apiBase, resolveKey } from "./lib/output.mjs";

const API = apiBase();

export function verdict({ envelope, events, recipients }) {
  const types = events.map((e) => e.type);

  if (types.includes("recipient.hard_bounced") || types.includes("recipient.soft_bounced")) {
    return {
      code: "RECIPIENT_BOUNCED",
      message: "A recipient's email bounced, so they never received the signing request.",
      next: [
        "Check the recipient address for typos",
        "MCP: list_emails with the envelope id to read the bounce detail",
        "Replace the recipient: POST /recipients/{id}/replace",
      ],
    };
  }
  if (envelope.status === "processing") {
    return {
      code: "STUCK_PROCESSING",
      message: "The envelope is still preparing documents. Document URLs must be publicly reachable.",
      next: [
        "Confirm every document URL returns 200 to an anonymous request",
        "Confirm each file is a valid PDF or DOCX",
        "If it has been stuck for more than a few minutes, contact support@signatureapi.com",
      ],
    };
  }
  if (envelope.status === "failed") {
    return {
      code: "ENVELOPE_FAILED",
      message: "The envelope failed. The failure reason is on the envelope.",
      next: ["MCP: get_envelope to read the failure reason"],
    };
  }
  if (envelope.status === "completed" && !types.includes("deliverable.generated")) {
    return {
      code: "DELIVERABLE_MISSING",
      message: "The envelope completed but no deliverable.generated event exists yet.",
      next: [
        `curl -sS -H "X-API-Key: $SIGNATUREAPI_KEY" ${API}/envelopes/<id>/deliverables`,
        "If it stays missing, contact support@signatureapi.com with the envelope id",
      ],
    };
  }
  if (envelope.status === "completed") {
    return { code: "OK", message: "The envelope completed and a deliverable was generated.", next: [] };
  }
  return {
    code: "IN_PROGRESS",
    message: `The envelope is ${envelope.status}; recipients have not all completed.`,
    next: [
      "MCP: get_envelope to see which recipient is pending",
      "In test mode, use list_emails + get_email to reach the ceremony link yourself",
    ],
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // This skill is read-only by construction (GET requests only, enforced by
  // test/diagnose-read-only.test.mjs — see references/errors.md), so it may
  // run against a live key with no flag: reading a production envelope
  // during an incident is exactly the behaviour wanted here, inside this
  // guarded, GET-only path, rather than in improvised curl.
  const { key, mode } = resolveKey(process.env.SIGNATUREAPI_KEY);
  const id = arg("envelope");
  if (!id) fail("MISSING_ENVELOPE_ID", "Pass --envelope <id>.", ["node scripts/diagnose-envelope.mjs --envelope env_..."]);

  const headers = { "X-API-Key": key };
  const [envelopeRes, eventsRes] = await Promise.all([
    fetch(`${API}/envelopes/${id}`, { headers }),
    fetch(`${API}/envelopes/${id}/events`, { headers }),
  ]);

  // 401/403/500 are not "not found" — collapsing them into
  // ENVELOPE_NOT_FOUND and pointing the user at mode confusion sends them
  // chasing the wrong problem. Distinguish them before ever looking at a
  // body that, for a non-2xx, is a problem-details document rather than an
  // envelope.
  if (envelopeRes.status === 401 || envelopeRes.status === 403) {
    fail("API_KEY_REJECTED", `The API key was rejected (HTTP ${envelopeRes.status}) fetching envelope ${id}.`, [
      "Check the key at https://dashboard.signatureapi.com/api-keys",
    ]);
  }
  if (envelopeRes.status === 404) {
    fail("ENVELOPE_NOT_FOUND", `No envelope ${id} for this key. Check you are in the right mode.`, [
      "Confirm the key's mode: test envelopes are invisible to a live key and vice versa",
    ]);
  }
  if (!envelopeRes.ok) {
    fail("ENVELOPE_FETCH_FAILED", `HTTP ${envelopeRes.status} fetching envelope ${id}.`, [
      "This is a server-side failure, not a diagnosable envelope symptom — retry, or contact support@signatureapi.com",
    ]);
  }

  const envelope = await envelopeRes.json();
  // The events fetch failing is not fatal to diagnosis — the envelope alone
  // still yields a verdict — but silently treating a failed fetch the same
  // as "no events happened" would be exactly the kind of failure-degrades-
  // into-success this repo has been burned by before. Surface it instead.
  const eventsBody = eventsRes.ok ? await eventsRes.json().catch(() => null) : null;
  const eventsFetchFailed = eventsBody === null;
  const events = eventsBody?.data ?? [];
  ok({
    mode,
    envelope_id: id,
    status: envelope.status,
    events: events.map((e) => e.type),
    ...(eventsFetchFailed ? { events_fetch_failed: `HTTP ${eventsRes.status} reading events; verdict below did not see them` } : {}),
    verdict: verdict({ envelope, events, recipients: envelope.recipients ?? [] }),
  });
}
