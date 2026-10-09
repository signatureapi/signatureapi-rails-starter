#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. REST fallback for
// the MCP list_events tool: polls a test-mode envelope's events until it
// reaches a terminal status, to confirm a ceremony actually completed.
// Test-mode tooling, not production code. Full workflow: SKILL.md.
import { ok, fail, apiBase, requireTestKey } from "./lib/output.mjs";

const API = apiBase();

export function isTerminal(status) {
  return ["completed", "failed", "canceled"].includes(status);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

export function hasFlag(name, argv = process.argv) {
  return argv.includes(`--${name}`);
}

/** One fetch of events + envelope status, no polling. Shared by --once and
 * by each iteration of the polling loop below. */
async function fetchOnce({ api, envelopeId, key }) {
  const res = await fetch(`${api}/envelopes/${envelopeId}/events`, { headers: { "X-API-Key": key } });
  if (!res.ok) {
    fail("EVENTS_FETCH_FAILED", `HTTP ${res.status} reading events.`, ["node scripts/check-setup.mjs"]);
  }
  const { data = [] } = await res.json();
  const envelope = await fetch(`${api}/envelopes/${envelopeId}`, { headers: { "X-API-Key": key } })
    .then((r) => r.json())
    .catch(() => ({}));
  return { events: data, envelope };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = requireTestKey(process.env.SIGNATUREAPI_KEY);
  const envelopeId = arg("envelope");
  if (!envelopeId) {
    fail("MISSING_ENVELOPE_ID", "Pass --envelope <id>.", [
      "node scripts/watch-events.mjs --envelope env_...",
    ]);
  }

  if (hasFlag("once")) {
    // Single check, no polling: fetch current status and events once and
    // exit — for a caller that just wants "what's true right now", not a
    // blocking wait for a terminal status.
    const { events, envelope } = await fetchOnce({ api: API, envelopeId, key });
    ok({
      envelope_id: envelopeId,
      status: envelope.status ?? null,
      terminal: isTerminal(envelope.status),
      events: events.map((e) => e.type),
    });
  }

  const timeoutMs = Number(arg("timeout", "300")) * 1000;
  const started = Date.now();
  const seen = [];

  while (Date.now() - started < timeoutMs) {
    const { events, envelope } = await fetchOnce({ api: API, envelopeId, key });
    for (const event of events) {
      if (!seen.some((e) => e.id === event.id)) seen.push(event);
    }
    if (isTerminal(envelope.status)) {
      ok({
        envelope_id: envelopeId,
        status: envelope.status,
        events: seen.map((e) => e.type),
      });
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  fail("WATCH_TIMED_OUT", `Envelope ${envelopeId} did not reach a terminal status in time.`, [
    `curl -sS -H "X-API-Key: $SIGNATUREAPI_KEY" ${API}/envelopes/${envelopeId}`,
    "MCP: get_envelope to inspect recipient status",
    "Or re-run with --once for a single check instead of a blocking wait",
  ]);
}
