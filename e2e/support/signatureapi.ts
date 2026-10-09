import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { app } from "../app.config.ts";

// Test-side access to SignatureAPI. The app under test never uses this file.

const API = "https://api.signatureapi.com/v1";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", app.envFile);
if (existsSync(envPath)) process.loadEnvFile(envPath);

function apiKey(): string {
  const key = process.env.SIGNATUREAPI_KEY;
  if (!key) throw new Error(`SIGNATUREAPI_KEY is not set (looked in ${envPath}). Run \`npx --yes signatureapi init\`.`);
  if (!key.startsWith("key_test_")) throw new Error("The e2e test runs in test mode only; use a key_test_ key.");
  return key;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "X-API-Key": apiKey(), "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * The app sends with `email_link`, so the signing link lives only in the
 * email, which test mode does not send. The test replaces that ceremony with
 * a `custom` one whose URL the API returns. This revokes the emailed link,
 * which is fine for a test envelope and nothing a real app should copy.
 */
export async function testCeremonyUrl(envelopeId: string): Promise<string> {
  const envelope = await call<{ recipients: { id: string; key: string }[] }>("GET", `/envelopes/${envelopeId}`);
  const signer = envelope.recipients.find((r) => r.key === "signer") ?? envelope.recipients[0];
  const ceremony = await call<{ url: string | null }>("POST", `/recipients/${signer.id}/ceremonies`, {
    authentication: [
      {
        type: "custom",
        provider: "No identity verification performed",
        data: { note: "Automated end-to-end test of a SignatureAPI example app; no identity check occurred." },
      },
    ],
  });
  if (!ceremony.url) throw new Error("The test ceremony has no url.");
  return ceremony.url;
}
