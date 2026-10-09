#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. Checks that
// SIGNATUREAPI_KEY is set, is a test key, and that the API is reachable —
// the first step of the skill's Build sequence. Test-mode tooling, not
// production code. Full workflow: SKILL.md.
import { ok, fail, apiBase, requireTestKey } from "./lib/output.mjs";

const API = apiBase();
const key = requireTestKey(process.env.SIGNATUREAPI_KEY);

const res = await fetch(`${API}/envelopes?limit=1`, { headers: { "X-API-Key": key } });

if (res.status === 401 || res.status === 403) {
  fail("API_KEY_REJECTED", `The API key was rejected (HTTP ${res.status}).`, [
    "Check the key at https://dashboard.signatureapi.com/api-keys",
    "export SIGNATUREAPI_KEY=key_test_...",
  ]);
}
if (!res.ok) {
  fail("API_UNREACHABLE", `HTTP ${res.status} from ${API}.`, [
    "curl -sS https://signatureapi.statuspage.io/api/v2/status.json",
  ]);
}

ok({
  mode: key.startsWith("key_test_") ? "test" : "live",
  api: API,
  mcp: "https://mcp.signatureapi.com/mcp",
  note: "MCP tools are called by the agent directly; these scripts are the REST fallback and local tooling.",
});
