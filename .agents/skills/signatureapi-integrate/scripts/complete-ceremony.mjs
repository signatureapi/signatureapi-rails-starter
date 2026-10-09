#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. Branch B of the
// verification loop: drives a real Chromium browser through a test-mode
// signing ceremony, then verifies completion against the API rather than
// trusting the browser walk finishing without error. Test-mode tooling,
// not production code, and cannot be pointed at a live key — see
// SKILL.md for the full workflow.
//
// Design rule, applied everywhere in this file: every guard in this script
// fails closed. If a check cannot be evaluated — a selector that should
// match one element matches more or errors, a recipient that can't be
// identified, a control whose label can't be read — it refuses, loudly,
// rather than treating "I don't know" as "must be fine". This repo has
// shipped three separate defects that were all the same shape: a failure
// path that quietly degraded into a reported success (a walker that printed
// `walked: true` when nothing happened; a decline guard that permitted a
// click when it couldn't read a label; a swallowed selector error that
// skipped a whole step while `noteFallbackIfUsed` still reported the
// contract satisfied). None of that is allowed here anymore.
//
// --embedded <redirect|message> walks the ceremony the way an app embeds it
// and also proves the terminal event reached the embedding page. The same
// rule holds there. An event is counted only when it was captured from the
// delivery mechanism itself: the Navigation API `navigate` event for a
// `signatureapi-message:` URL (redirect), or a postMessage that passed the
// origin AND source check on the host page (message). Console output is
// never read: a log line proves nothing was delivered. Exactly one event,
// `ceremony.completed`, must arrive; none, several, or any other type
// fails, and the API poll still runs after that as the source of truth.
// The embedded guards, each failing closed:
//   - every flag is read in both `--name value` and `--name=value` form, and
//     a flag with no value is an error, never "not given" (INVALID_FLAG_VALUE,
//     INVALID_EMBEDDED_MODE);
//   - message mode needs a usable `embeddable_in` origin to host the page on
//     (EMBED_ORIGIN_MISSING); the route for that origin serves only the host
//     page and aborts every other request, so no real host is contacted;
//   - the frame counts as loaded only when it has the ceremony's origin and a
//     known signer UI element; a frame the ceremony's CSP refused fails with
//     EMBED_FRAME_BLOCKED, naming the origin embeddable_in must list;
//   - a required step that never appears, after an event already arrived,
//     reports that event (a ceremony.failed names its error_type) instead of
//     CEREMONY_WALK_STEP_NOT_FOUND;
//   - the "Confirm to continue" dialog is never confirmed in an embedded walk
//     (ORGANIC_INPUT_NOT_ARMED): the app's signer produces real pointer input;
//   - any error not turned into a named refusal leaves as CEREMONY_WALK_ERROR,
//     through the same JSON fail output.
import { ok, fail, apiBase, requireTestKey } from "./lib/output.mjs";

const API = apiBase();

/**
 * Reads `--name value` or `--name=value` from argv. Both spellings count, so
 * an equals-form flag is never silently ignored (an ignored `--embedded=message`
 * once ran a plain walk and reported ok). `present` is true whenever the flag
 * appears; `value` is undefined when it has none (last argument, or followed
 * by another flag), and "" for `--name=`. Callers treat a present flag with no
 * usable value as an error, not as absent.
 */
export function readFlag(argv, name) {
  const bare = `--${name}`;
  const prefix = `${bare}=`;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === bare) {
      const next = argv[i + 1];
      return { present: true, value: next === undefined || next.startsWith("--") ? undefined : next };
    }
    if (typeof token === "string" && token.startsWith(prefix)) {
      return { present: true, value: token.slice(prefix.length) };
    }
  }
  return { present: false, value: undefined };
}

function arg(name, fallback) {
  const flag = readFlag(process.argv, name);
  return flag.present ? flag.value : fallback;
}

/**
 * A ceremony URL carries a fresh, re-signed JWT on every fetch (SignatureAPI
 * mints a new `iat`/`exp`/signature each time `GET /envelopes/{id}` is
 * called — confirmed on staging: two fetches of the same untouched envelope
 * a second apart return two different URLs). So the URL string itself is not
 * a stable identifier and cannot be compared byte-for-byte across two
 * separate reads. The `ceremony_id` claim inside the token IS stable across
 * fetches; extracting it is the only way to recognize "the same ceremony" in
 * two URLs obtained at different times, since a ceremony has no id field of
 * its own to resolve independently (no id field on Ceremony, no GET for it).
 */
export function extractCeremonyId(url) {
  try {
    const token = new URL(url).searchParams.get("token");
    if (!token) return null;
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json);
    return typeof claims.ceremony_id === "string" ? claims.ceremony_id : null;
  } catch {
    return null;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Every non-null ceremony URL on the envelope, optionally scoped to one recipient key. */
export function collectCeremonyUrls(envelope, recipientKey) {
  const recipients = envelope?.recipients ?? [];
  const candidates = recipientKey ? recipients.filter((r) => r.key === recipientKey) : recipients;
  return candidates.map((r) => r?.ceremony?.url).filter(Boolean);
}

/** The safe outcome when an email-link ceremony has no API-returned URL this script can verify. */
export function ceremonyUrlUnavailable() {
  return {
    code: "CEREMONY_URL_NOT_RETURNED",
    message:
      "ceremony.url is null for this recipient. This is expected for email_link authentication because possession of the emailed link is the authentication, and this script cannot verify that private URL against the envelope.",
    next: [
      "Use Branch A: a human opens the link from the test email log and completes the ceremony",
      "For an agent-driven test, create a separate custom-auth test envelope whose ceremony.url is returned by the API",
    ],
  };
}

/**
 * When both --envelope and --url are supplied, the envelope fetch alone only
 * proves the *id* is a visible test-mode envelope — it proves nothing about
 * the *URL* being driven. This ties the two together: the supplied URL must
 * belong to a ceremony this envelope actually returned. Matching is by
 * `ceremony_id` claim (see extractCeremonyId) plus origin, not literal URL
 * equality, because the URL string is re-minted on every fetch. The origin
 * check means a URL cannot pass by merely echoing a real ceremony_id from
 * some other host — the JWT's signature is still not verified here, so this
 * is not a cryptographic proof, but combined with the envelope fetch already
 * having proven test-mode visibility of the id, and the origin match ruling
 * out any host swap, it is the strongest check available without a
 * ceremony-resolution endpoint (which does not exist).
 */
export function checkSuppliedUrlAgainstEnvelope(envelope, suppliedUrl, recipientKey) {
  const urls = collectCeremonyUrls(envelope, recipientKey);

  if (urls.length === 0) {
    return {
      ok: false,
      code: "EMAIL_LINK_URL_UNVERIFIABLE",
      message: "This envelope returns no ceremony.url on any recipient (email_link authentication does this by design), so the supplied --url cannot be checked against it — there is nothing to match it to. This script cannot prove an arbitrary URL belongs to a test-mode envelope, and completing an unverified ceremony URL could sign something real.",
      next: [
        "Verify with a custom-auth envelope instead: create-test-envelope.mjs's default custom authentication returns ceremony.url on the envelope itself, so it can be checked",
        "Or use Branch A for this envelope: hand its ceremony link to a human to complete",
      ],
    };
  }

  const suppliedId = extractCeremonyId(suppliedUrl);
  const suppliedOrigin = originOf(suppliedUrl);
  const matches = urls.some(
    (u) => suppliedId && extractCeremonyId(u) === suppliedId && originOf(u) === suppliedOrigin,
  );

  if (!matches) {
    return {
      ok: false,
      code: "URL_ENVELOPE_MISMATCH",
      message: "The supplied --url does not match any ceremony this envelope returned, so it cannot be proven to belong to it. --envelope proves the id is test-mode; it does not prove the URL is that envelope's.",
      next: [
        "Use a ceremony URL this envelope actually returned (recipients[].ceremony.url from create-test-envelope.mjs or get_envelope) — fetch it fresh, the URL is re-minted on every read but its ceremony stays the same one",
      ],
    };
  }

  return { ok: true };
}

/**
 * Which recipient's ceremony the script is about to drive, so the completion
 * check at the end polls the right recipient. Prefers an explicit
 * --recipient. Otherwise matches by ceremony_id (see extractCeremonyId) plus
 * origin, the same stable-identity comparison checkSuppliedUrlAgainstEnvelope
 * uses — the URL string itself is re-minted on every fetch, so it cannot be
 * compared literally.
 */
export function resolveTargetRecipientKey(envelope, url, recipientKeyArg) {
  if (recipientKeyArg) return recipientKeyArg;
  const recipients = envelope?.recipients ?? [];
  const targetId = extractCeremonyId(url);
  if (!targetId) return null;
  const targetOrigin = originOf(url);
  const match = recipients.find((r) => {
    const rUrl = r?.ceremony?.url;
    if (!rUrl) return false;
    return extractCeremonyId(rUrl) === targetId && originOf(rUrl) === targetOrigin;
  });
  return match?.key ?? null;
}

const TERMINAL_NON_COMPLETED_RECIPIENT_STATUSES = ["rejected", "soft_bounced", "hard_bounced", "failed", "replaced"];

/**
 * The only source of truth for "did this ceremony actually complete": polls
 * GET /envelopes/{id} until the target recipient reaches `completed`, or a
 * terminal non-completed status, or the timeout expires. The browser walk
 * finishing without error proves nothing by itself — an earlier version of
 * this script reported success after a walk whose clicks silently no-op'd. This is the check that replaces that false claim.
 *
 * `recipientKey` is required — it is never defaulted to `recipients[0]`.
 * `resolveTargetRecipientKey` returns null whenever the ceremony URL's
 * `ceremony_id` claim couldn't be parsed, and on a multi-recipient envelope
 * silently checking recipients[0] in that case can verify a recipient who
 * was already `completed` before this walk even started — reporting
 * `verified: true` for a walk that signed nothing. Refusing to guess here is
 * what closes that gap.
 */
export async function pollForRecipientCompletion({ api, envelopeId, recipientKey, key, timeoutMs, intervalMs = 3000 }) {
  if (!recipientKey) {
    return {
      completed: false,
      code: "RECIPIENT_KEY_UNRESOLVED",
      envelope: null,
      recipient: null,
    };
  }
  const started = Date.now();
  let lastEnvelope = null;
  do {
    const res = await fetch(`${api}/envelopes/${envelopeId}`, { headers: { "X-API-Key": key } });
    if (res.ok) {
      lastEnvelope = await res.json();
      const recipients = lastEnvelope?.recipients ?? [];
      const recipient = recipients.find((r) => r.key === recipientKey);
      if (recipient?.status === "completed") {
        return { completed: true, envelope: lastEnvelope, recipient };
      }
      if (recipient && TERMINAL_NON_COMPLETED_RECIPIENT_STATUSES.includes(recipient.status)) {
        return { completed: false, envelope: lastEnvelope, recipient };
      }
    }
    if (Date.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() - started < timeoutMs);
  return { completed: false, envelope: lastEnvelope, recipient: null };
}

export const EMBEDDED_MODES = ["redirect", "message"];
export const REDIRECT_EVENT_PREFIX = "signatureapi-message:";
/** The id of the iframe on the host page that message mode serves. */
export const HOST_PAGE_FRAME_ID = "ceremony";

/** The ceremony URL an app loads: `embedded=true` plus the event delivery mode. */
export function embeddedCeremonyUrl(ceremonyUrl, delivery) {
  if (!EMBEDDED_MODES.includes(delivery)) {
    throw new Error(`Unknown event delivery "${delivery}"; expected one of ${EMBEDDED_MODES.join(", ")}`);
  }
  const url = new URL(ceremonyUrl);
  url.searchParams.set("embedded", "true");
  url.searchParams.set("event_delivery", delivery);
  return url.toString();
}

/** Keeps only the fields a ceremony event carries. Anything without a string `type` is not an event. */
function pickEventFields(fields) {
  const event = { type: typeof fields?.type === "string" && fields.type ? fields.type : null };
  for (const name of ["error_type", "error_message"]) {
    if (typeof fields?.[name] === "string") event[name] = fields[name];
  }
  return event;
}

/**
 * Parses the URL the ceremony navigates to with event_delivery=redirect:
 * `signatureapi-message://<type>/?error_type=…&error_message=…`. The event
 * type is the URL host; the fields are form-encoded query parameters (`+` is
 * a space). Returns null for anything that is not such a URL, so a caller
 * never mistakes an ordinary navigation for an event.
 */
export function parseRedirectEvent(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== REDIRECT_EVENT_PREFIX || !parsed.host) return null;
  return pickEventFields({ ...Object.fromEntries(parsed.searchParams), type: parsed.host });
}

/** The event carried by a postMessage payload that passed the host page's origin and source check. */
export function parseMessageEvent(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { type: null };
  return pickEventFields(data);
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The origin the message-mode host page is served from: the first usable
 * `embeddable_in` entry. Each entry is parsed with `new URL()` (a missing
 * scheme means https; the path is ignored), so a bracketed IPv6 host such as
 * `[::1]` parses like any other. Rules, in order:
 *
 *   - a wildcard entry is skipped: it names many origins, not one to serve;
 *   - an https entry is used as is;
 *   - an http loopback entry is used as is;
 *   - any other http entry is upgraded to https on the same host and port,
 *     because a CSP3 host-source `http://x` also matches `https://x`.
 *
 * Returns null when no entry fits.
 */
export function pickEmbedOrigin(embeddableIn) {
  if (!Array.isArray(embeddableIn)) return null;
  for (const entry of embeddableIn) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.includes("*")) continue;
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      continue;
    }
    if (!url.hostname) continue;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol !== "http:") continue;
    if (LOOPBACK_HOSTS.includes(url.hostname)) return url.origin;
    return new URL(`https://${url.host}`).origin;
  }
  return null;
}

/** Resolves where message mode serves its host page, or the refusal when it cannot. */
export function embedOriginFor(recipient) {
  if (!recipient) {
    return {
      ok: false,
      code: "RECIPIENT_KEY_UNRESOLVED",
      message: "Could not determine which recipient's ceremony this is, so its embeddable_in origins cannot be read. Message mode needs them to host the page the ceremony is framed in.",
      next: ["Pass --recipient <key> explicitly"],
    };
  }
  const origin = pickEmbedOrigin(recipient?.ceremony?.embeddable_in);
  if (!origin) {
    return {
      ok: false,
      code: "EMBED_ORIGIN_MISSING",
      message: `Recipient "${recipient.key}" has no embeddable_in entry naming one https origin (or an http loopback origin). The ceremony refuses to load in a frame whose origin is not listed, so message mode has no page to host it on.`,
      next: [
        "Create the ceremony with embeddable_in listing the origin of the page that frames it, for example https://app.example.invalid",
        "Or run --embedded redirect, which loads the ceremony top-level and needs no embeddable_in",
      ],
    };
  }
  return { ok: true, origin };
}

const escapeHtmlAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The page message mode serves at the embed origin. It frames the ceremony
 * and forwards a message only when it comes from the ceremony's origin AND
 * from this iframe's window; every other message is forwarded as rejected so
 * the check is visible in the output. `bridge` is the binding name exposed
 * by the walker.
 */
export function renderHostPage(ceremonySrc, bridge) {
  const ceremonyOrigin = new URL(ceremonySrc).origin;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing ceremony</title>
<style>html, body { margin: 0; height: 100%; } iframe { display: block; width: 100%; height: 100%; border: 0; }</style>
</head>
<body>
<iframe id="${HOST_PAGE_FRAME_ID}" title="Signing ceremony" src="${escapeHtmlAttribute(ceremonySrc)}"></iframe>
<script>
  (function () {
    var CEREMONY_ORIGIN = ${JSON.stringify(ceremonyOrigin)};
    var frame = document.getElementById(${JSON.stringify(HOST_PAGE_FRAME_ID)});
    window.addEventListener("message", function (event) {
      var accepted = event.origin === CEREMONY_ORIGIN && event.source === frame.contentWindow;
      window[${JSON.stringify(bridge)}](JSON.stringify(
        accepted ? { kind: "event", data: event.data } : { kind: "rejected", origin: event.origin }
      ));
    });
  })();
</script>
</body>
</html>
`;
}

/**
 * Redirect mode: opens the ceremony top-level and records every navigation
 * to a `signatureapi-message:` URL, through the Navigation API `navigate`
 * event (the moment a WebView's navigation handler sees it). The binding
 * accepts calls from the main frame only. Returns whether the page has the
 * Navigation API at all; without it nothing could be recorded.
 */
export async function openWithRedirectCapture(page, ceremonySrc, deliveredEvents) {
  await page.exposeBinding("__signatureapiNavigation", (source, destination) => {
    if (source.frame !== page.mainFrame()) return;
    const event = parseRedirectEvent(destination);
    if (event) deliveredEvents.push({ ...event, via: "redirect" });
  });
  await page.addInitScript((prefix) => {
    if (window.top !== window) return;
    window.__signatureapiNavigationApi = typeof window.navigation?.addEventListener === "function";
    window.navigation?.addEventListener("navigate", (event) => {
      const destination = event.destination?.url ?? "";
      if (destination.startsWith(prefix)) window.__signatureapiNavigation(destination);
    });
  }, REDIRECT_EVENT_PREFIX);
  await page.goto(ceremonySrc, { waitUntil: "networkidle" });
  return page.evaluate(() => window.__signatureapiNavigationApi === true).catch(() => false);
}

/** Elements only the signer UI renders: the step contract, or its older private ids. */
export const CEREMONY_ELEMENT_SELECTOR =
  '[data-ceremony-step], #concent-modal, #primary-button, #primary-button-inline, button[aria-label="Sign here"]';

/**
 * Message mode: serves renderHostPage at `embedOrigin` and records what it
 * forwards. The route matches by exact origin and fails closed: only the
 * main-frame navigation to `${embedOrigin}/` gets the host page, and every
 * other request to that origin is aborted, so nothing ever reaches a real
 * host there. The binding accepts calls from the main frame (the host page)
 * only.
 *
 * The frame counts as loaded only when its document has the ceremony's
 * origin AND shows a known ceremony element. A frame the ceremony's CSP
 * refuses still has a body (Chromium's error page), so "a body exists" is
 * not evidence. Never throws: returns `{ ok: true, frame }` or a
 * `{ ok: false, code, message, next }` refusal for the fail contract.
 */
export async function openInHostPage(page, { embedOrigin, ceremonySrc, deliveredEvents, rejectedOrigins, frameTimeoutMs = 20000 }) {
  const bridge = "__signatureapiEmbedBridge";
  const hostUrl = `${embedOrigin}/`;
  const ceremonyOrigin = new URL(ceremonySrc).origin;
  try {
    await page.exposeBinding(bridge, (source, raw) => {
      if (source.frame !== page.mainFrame()) return;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed?.kind === "event") deliveredEvents.push({ ...parseMessageEvent(parsed.data), via: "message" });
      else rejectedOrigins.push(String(parsed?.origin ?? ""));
    });
    const hostPage = renderHostPage(ceremonySrc, bridge);
    await page.route(
      (url) => url.origin === embedOrigin,
      (route) => {
        const request = route.request();
        let mainFrame = false;
        try {
          mainFrame = request.frame() === page.mainFrame();
        } catch {
          mainFrame = false;
        }
        if (request.url() === hostUrl && request.isNavigationRequest() && mainFrame) {
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: hostPage });
        }
        return route.abort("blockedbyclient");
      },
    );
    await page.goto(hostUrl, { waitUntil: "load", timeout: 30000 });
  } catch (e) {
    return {
      ok: false,
      code: "EMBED_HOST_PAGE_FAILED",
      message: `Could not serve the host page at ${hostUrl}: ${e?.message ?? e}`,
      next: ["Re-run with PWDEBUG=1 to watch the browser", "Or run --embedded redirect, which needs no host page"],
    };
  }

  const deadline = Date.now() + frameTimeoutMs;
  let originMatched = false;
  let lastFrameUrl = null;
  while (Date.now() < deadline && deliveredEvents.length === 0) {
    const frame = await page
      .$(`#${HOST_PAGE_FRAME_ID}`)
      .then((handle) => handle?.contentFrame() ?? null)
      .catch(() => null);
    lastFrameUrl = frame ? frame.url() : null;
    if (frame && originOf(lastFrameUrl) === ceremonyOrigin) {
      originMatched = true;
      const count = await frame.locator(CEREMONY_ELEMENT_SELECTOR).count().catch(() => 0);
      if (count > 0) return { ok: true, frame: page.frameLocator(`#${HOST_PAGE_FRAME_ID}`) };
    }
    await page.waitForTimeout(250);
  }

  if (!originMatched && deliveredEvents.length === 0) {
    return {
      ok: false,
      code: "EMBED_FRAME_BLOCKED",
      message: `The ceremony never loaded in the frame on the host page at ${embedOrigin} (the frame shows ${JSON.stringify(lastFrameUrl)}, not ${ceremonyOrigin}). The ceremony refuses to be framed by an origin that is not in the recipient's embeddable_in, so ${embedOrigin} must be listed there.`,
      next: [
        `Create the ceremony with embeddable_in listing ${embedOrigin}`,
        "Or run --embedded redirect, which loads the ceremony top-level and needs no embeddable_in",
      ],
    };
  }
  return stepNotFoundOutcome({
    events: deliveredEvents,
    via: "message",
    step: "loading the ceremony in the host page frame",
    name: "a signer UI element",
  });
}

/**
 * The refusal for a required step that never appeared. When the page has
 * already received a ceremony event, that event is the real cause (a revoked
 * or completed link sends ceremony.failed at load), so its classification is
 * returned instead: it names the error_type.
 */
export function stepNotFoundOutcome({ events, via, step, name, visibleButtons = [] }) {
  if (Array.isArray(events) && events.length > 0) {
    const delivered = classifyDeliveredEvents(events, { expected: "ceremony.completed", via });
    if (!delivered.ok) return delivered;
  }
  return {
    ok: false,
    code: "CEREMONY_WALK_STEP_NOT_FOUND",
    message: `Could not find "${name}" while ${step}.`,
    next: [
      `Buttons visible on the page at that point: ${JSON.stringify(visibleButtons.filter(Boolean))}`,
      "Re-run with PWDEBUG=1 to watch the browser",
      "The ceremony UI may differ from the sequence this script expects (place types/auth can vary) — inspect and update the selectors",
    ],
  };
}

/**
 * Decides whether the walk delivered exactly the expected terminal event
 * through the expected mechanism. No event, more than one, an unreadable
 * one, the wrong type, or the wrong delivery path each fail: a ceremony
 * sends one terminal event, and anything else means the embedding would not
 * have seen what the walk claims.
 */
export function classifyDeliveredEvents(events, { expected = "ceremony.completed", via } = {}) {
  const list = Array.isArray(events) ? events : [];
  const summary = JSON.stringify(list.map((e) => ({ type: e?.type ?? null, via: e?.via ?? null, ...(e?.error_type ? { error_type: e.error_type } : {}) })));
  if (list.length === 0) {
    return {
      ok: false,
      code: "CEREMONY_EVENT_NOT_DELIVERED",
      message: `The walk finished but no ceremony event reached the embedding page (expected ${expected}${via ? ` via ${via}` : ""}).`,
      next: [
        "Re-run with PWDEBUG=1 to watch the browser",
        "Check that the ceremony URL carries embedded=true and the event delivery mode",
      ],
    };
  }
  const [event] = list;
  const wrongPath = via && list.some((e) => e?.via !== via);
  if (list.length > 1 || event?.type !== expected || wrongPath) {
    const failed = event?.type === "ceremony.failed" && event.error_type ? ` The ceremony reported error_type ${event.error_type}.` : "";
    return {
      ok: false,
      code: "CEREMONY_EVENT_UNEXPECTED",
      message: `Expected exactly one ${expected} event${via ? ` via ${via}` : ""}; the embedding page received ${summary}.${failed}`,
      next: [
        "Branch on error_type for a ceremony.failed event: an expired, replaced or completed link reports it",
        "Fetch a fresh ceremony URL from the envelope and walk it again",
      ],
    };
  }
  return { ok: true, event: { type: event.type, via: event.via } };
}

async function main() {
  // No flag gates this run. An agent invokes this script non-interactively,
  // so any condition a flag could check ("has the user agreed?"), the agent
  // could already satisfy on its own initiative by simply passing it — no
  // in-band mechanism can obtain actual human consent from a non-interactive
  // session. A flag shaped like a consent gate is worse than no flag at all:
  // it invites everyone reading this script to believe something is being
  // enforced when nothing is. What actually keeps this script out of harm's
  // way is structural and enforced above, not here: requireTestKey() has no
  // bypass path, so it cannot be pointed at a live key under any argument.
  const key = requireTestKey(process.env.SIGNATUREAPI_KEY);

  // A flag given without a value is an error, never "not given": a dropped
  // --recipient would otherwise fall back to URL matching unannounced.
  for (const name of ["url", "envelope", "recipient", "timeout"]) {
    const flag = readFlag(process.argv, name);
    if (flag.present && !flag.value) {
      fail("INVALID_FLAG_VALUE", `--${name} was given without a value.`, [`Pass --${name} <value> or --${name}=<value>`]);
    }
  }
  const timeoutSeconds = Number(arg("timeout", "120"));
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    fail("INVALID_FLAG_VALUE", `--timeout takes a positive number of seconds; got ${JSON.stringify(arg("timeout"))}.`, ["Pass --timeout 120"]);
  }

  const escapeHatchUrl = arg("url");
  const envelopeId = arg("envelope");

  const embeddedFlag = readFlag(process.argv, "embedded");
  const embeddedMode = embeddedFlag.present ? (embeddedFlag.value ?? "") : null;
  if (embeddedMode !== null && !EMBEDDED_MODES.includes(embeddedMode)) {
    fail("INVALID_EMBEDDED_MODE", `--embedded takes one of ${EMBEDDED_MODES.join(", ")}; got ${JSON.stringify(embeddedMode ?? null)}.`, [
      "node scripts/complete-ceremony.mjs --envelope <id> --embedded redirect",
      "node scripts/complete-ceremony.mjs --envelope <id> --embedded message",
    ]);
  }

  if (escapeHatchUrl && !envelopeId) {
    fail("URL_REQUIRES_ENVELOPE", "A --url given without --envelope cannot be proven to belong to a test-mode ceremony, and there is no flag to bypass that — pass --envelope <id> alongside --url so fetching the envelope with your test key proves test mode.", [
      "node scripts/complete-ceremony.mjs --envelope <id> --url <ceremony url>",
    ]);
  }

  if (!escapeHatchUrl && !envelopeId) {
    fail("MISSING_ENVELOPE_ID", "Pass --envelope <id> (preferred) or --envelope <id> --url <ceremony url>.", [
      "node scripts/complete-ceremony.mjs --envelope <id>",
    ]);
  }

  let url = escapeHatchUrl;
  let envelope = null;
  let recipientKey = null;

  if (envelopeId) {
    // Fetching the envelope with the test key IS the mode gate: test and live
    // are separate namespaces, so a test key only ever sees a test envelope.
    // It proves the id is test-mode. It does NOT, by itself, prove that a
    // separately-supplied --url belongs to this envelope — see
    // checkSuppliedUrlAgainstEnvelope below for that check.
    recipientKey = arg("recipient");
    const res = await fetch(`${API}/envelopes/${envelopeId}`, { headers: { "X-API-Key": key } });
    // 401/403/500 are not "not visible" — collapsing them into the same
    // mode-confusion message as a genuine 404 sends the caller chasing the
    // wrong problem, and a non-2xx body is a problem-details document, not
    // an envelope, so it must never reach `envelope = await res.json()`.
    if (res.status === 401 || res.status === 403) {
      fail("API_KEY_REJECTED", `The API key was rejected (HTTP ${res.status}) fetching envelope ${envelopeId}.`, [
        "Check the key at https://dashboard.signatureapi.com/api-keys",
      ]);
    }
    if (res.status === 404) {
      fail("ENVELOPE_NOT_VISIBLE_TO_THIS_KEY", `No envelope ${envelopeId} is visible to this key. Test and live are separate namespaces, so this is not a test-mode envelope for this key.`, [
        "Confirm the key's mode: it must be a key_test_... key",
        "Use the envelope id printed by create-test-envelope.mjs",
      ]);
    }
    if (!res.ok) {
      fail("ENVELOPE_FETCH_FAILED", `HTTP ${res.status} fetching envelope ${envelopeId}.`, [
        "This is a server-side failure, not a mode/visibility problem — retry, or contact support@signatureapi.com",
      ]);
    }
    envelope = await res.json();

    if (url) {
      const check = checkSuppliedUrlAgainstEnvelope(envelope, url, recipientKey);
      if (!check.ok) {
        fail(check.code, check.message, check.next);
      }
    } else {
      const recipients = envelope?.recipients ?? [];
      const candidates = recipientKey
        ? recipients.filter((r) => r.key === recipientKey)
        : recipients;
      const recipient = candidates.find((r) => r?.ceremony?.url);

      if (!recipient) {
        const unavailable = ceremonyUrlUnavailable();
        fail(unavailable.code, unavailable.message, unavailable.next);
      }
      url = recipient.ceremony.url;
    }
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("PLAYWRIGHT_MISSING", "Playwright is not installed in this project.", [
      "npm install --save-dev playwright && npx playwright install chromium",
      "Or use Branch A instead (no browser needed)",
    ]);
  }

  // Who the completion check at the end verifies, resolved before driving
  // the browser so a typed-signature fallback has a name to use (see below).
  const targetRecipientKey = resolveTargetRecipientKey(envelope, url, recipientKey);
  const targetRecipient = (envelope?.recipients ?? []).find((r) => r.key === targetRecipientKey);

  // Message mode frames the ceremony on a page served at an embeddable_in
  // origin, so resolve that origin before launching anything.
  let embedOrigin = null;
  if (embeddedMode === "message") {
    const resolved = embedOriginFor(targetRecipient);
    if (!resolved.ok) fail(resolved.code, resolved.message, resolved.next);
    embedOrigin = resolved.origin;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Terminal events captured from the delivery mechanism itself (see the
  // file header). Bindings are exposed to every frame, so each one accepts
  // calls from the main frame only: the ceremony frame never calls them, and
  // a call from anywhere else is not evidence of delivery.
  const deliveredEvents = [];
  const rejectedMessageOrigins = [];
  let root = page;

  if (embeddedMode === "redirect") {
    const hasNavigationApi = await openWithRedirectCapture(page, embeddedCeremonyUrl(url, "redirect"), deliveredEvents);
    // Without the Navigation API there is no way to see the redirect event,
    // and "saw nothing" must not pass for "nothing was sent".
    if (!hasNavigationApi) {
      await browser.close();
      fail("NAVIGATION_API_UNAVAILABLE", "This Chromium build has no Navigation API, so the redirect event cannot be captured. Refusing to walk a ceremony whose event this script cannot see.", [
        "npx playwright install chromium",
        "Or run --embedded message",
      ]);
    }
  } else if (embeddedMode === "message") {
    const opened = await openInHostPage(page, {
      embedOrigin,
      ceremonySrc: embeddedCeremonyUrl(url, "message"),
      deliveredEvents,
      rejectedOrigins: rejectedMessageOrigins,
    });
    if (!opened.ok) {
      await browser.close();
      fail(opened.code, opened.message, opened.next);
    }
    root = opened.frame;
  } else {
    await page.goto(url, { waitUntil: "networkidle" });
  }

  // Arm completion with genuine pointer movement: the signer UI only enables
  // completion after organic pointer input, to keep link scanners from signing.
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(100 + i * 40, 150 + i * 25, { steps: 4 });
  }

  let walkLastStep = "loaded the ceremony page";

  // Embedded signers get Cancel instead of Decline, and clicking it ends the
  // ceremony with ceremony.canceled, so an embedded walk refuses it too.
  const DECLINE_LIKE = embeddedMode ? /decline|reject|refuse|cancel/i : /decline|reject|refuse/i;

  // The supported DOM contract (added alongside this change): stable
  // `data-ceremony-step` attributes on the elements each step of this walk
  // needs. This is the PRIMARY selector for every step below. The private
  // ids/labels this script used before (`#continue-consent-button`,
  // `#primary-button`/`#primary-button-inline`,
  // `button[aria-label="Sign here"]`, `#typed_symbol`, `#adopt-button`, the
  // consent/adoption checkboxes) are kept as a FALLBACK for an environment
  // that does not carry the attributes. The script reports every step that
  // needed the fallback, so a run against such an environment is visible in
  // its output rather than silent. When no environment needs them any more,
  // the `privateSelector` arguments below (and the fallback branch of
  // stepLocator/noteFallbackIfUsed) can be deleted.
  const fallbackStepsUsed = [];

  /** Combines the primary `data-ceremony-step` selector with the private
   * fallback selector into one Playwright locator (comma-separated CSS
   * selectors match on either). `modifier` lets a caller add a pseudo-class
   * like `:visible` to the primary half, matching what the private half
   * already carries. */
  function stepLocator(scope, dataStep, privateSelector, modifier = "") {
    return scope.locator(`[data-ceremony-step="${dataStep}"]${modifier}, ${privateSelector}`);
  }

  /** Records (and prints) when a step's match came only from the private
   * fallback selector, i.e. the new `data-ceremony-step` attribute was not
   * present — so we can see from the output when the transition to the new
   * contract is complete across environments. */
  async function noteFallbackIfUsed(scope, dataStep) {
    const primaryCount = await scope.locator(`[data-ceremony-step="${dataStep}"]`).count().catch(() => 0);
    if (primaryCount === 0) {
      fallbackStepsUsed.push(dataStep);
      console.error(`[complete-ceremony] step "${dataStep}": data-ceremony-step attribute not found, used private-id fallback selector (remove once deployed everywhere)`);
    }
  }

  /**
   * Probes an optional *container* locator (the disclosure/consent modal,
   * the signature adoption modal) and reports one of three genuinely
   * different outcomes, instead of collapsing "present" vs. everything else
   * into a boolean:
   *
   *   - "present"   exactly one element matched and became visible — proceed.
   *   - "absent"    the locator never matched anything (a real timeout with
   *                 zero matches) — the container legitimately isn't on this
   *                 page; tolerate it, the caller decides whether that's ok.
   *   - "ambiguous" the locator matched MORE than one element, or `count()`
   *                 itself errored, or `waitFor` failed for some reason
   *                 other than a plain "never appeared" timeout — refuse to
   *                 guess which element is the real one.
   *
   * This fixes a selector collision: `disclosure`/`adopt` used to be both
   * the checkbox attribute AND (via the private-id fallback) the container
   * selector, so once the checkboxes (rendered N-up in a `.map()`) also
   * carried a `data-ceremony-step` attribute, the combined selector matched
   * N+1 elements. Playwright's strict mode then raised on any action against
   * it, `.catch(() => false)` swallowed that into "absent", and the whole
   * step silently no-op'd while still being reported satisfied. Distinct
   * `-modal` container values (see the call sites below) fix the root
   * collision; this three-outcome check is the belt-and-suspenders so that
   * if a selector is EVER ambiguous again — for any reason — it fails loud
   * instead of disappearing into "absent".
   */
  async function probeContainer(locator, timeout) {
    let waitError = null;
    try {
      // Waiting on `.first()` avoids the wait itself throwing a strict-mode
      // error merely because there happen to be multiple matches — the
      // multiplicity is judged below, from `count()`, not from whether the
      // first match became visible.
      await locator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      waitError = e;
    }
    let count;
    try {
      count = await locator.count();
    } catch (e) {
      return { outcome: "ambiguous", detail: `count() failed: ${e?.message ?? e}` };
    }
    if (count > 1) {
      return { outcome: "ambiguous", detail: `matched ${count} elements` };
    }
    if (count === 1 && !waitError) {
      return { outcome: "present", detail: null };
    }
    if (count === 0 && waitError && /Timeout/i.test(waitError.message ?? "")) {
      return { outcome: "absent", detail: null };
    }
    // Any other combination — e.g. exactly one match but `waitFor` failed
    // for a non-timeout reason, or zero matches with a non-timeout error —
    // is not a shape this function understands. Refuse to guess.
    return { outcome: "ambiguous", detail: waitError ? (waitError.message ?? String(waitError)) : `unexpected match count ${count}` };
  }

  /**
   * Reads every accessible-name source Playwright can give us for a control
   * — visible text, `aria-label`, `title` — and joins whatever is non-blank.
   * Text content alone is blind to a whole class of control: the
   * ceremony's own signature place is labelled only by `aria-label`
   * (`button[aria-label="Sign here"]`), so a text-only check would see "" for
   * it and, under the old catch-and-default-to-"" behavior, let anything
   * through unchecked. This throws (does not catch) on a read failure —
   * callers must treat that as a refusal, not fall back to "".
   */
  async function readAccessibleLabel(locator) {
    const [text, ariaLabel, title] = await Promise.all([
      locator.textContent(),
      locator.getAttribute("aria-label"),
      locator.getAttribute("title"),
    ]);
    return [text, ariaLabel, title]
      .filter((s) => typeof s === "string" && s.trim() !== "")
      .join(" ")
      .trim();
  }

  /**
   * Click one specific, named control. Never falls through to a looser
   * match: if the control cannot be found, the walk fails loudly with what
   * WAS on the page instead of guessing at something else that might match.
   * Also refuses to click anything whose accessible label reads as a
   * decline/reject/refuse action — belt-and-suspenders on top of using
   * specific ids/labels instead of a generic "primary action" regex hunt,
   * which is what once let this script click "Decline to sign".
   *
   * Fails closed on the label check itself: the original version read
   * `textContent()` and treated a read failure as `""`, which passes the
   * decline regex and proceeds to click — a check that can't be evaluated
   * silently became permission. Here, a label that can't be read (any of
   * text/aria-label/title throws) or that reads as nothing at all across
   * all three sources is refused, not defaulted through.
   */
  async function clickStep({ step, locator, dataStep, scope, name, timeout = 15000, required = true }) {
    walkLastStep = step;
    try {
      await locator.waitFor({ state: "visible", timeout });
    } catch {
      if (!required) return false;
      const visibleButtons = await root.getByRole("button").allTextContents().catch(() => []);
      await browser.close();
      const refusal = stepNotFoundOutcome({ events: deliveredEvents, via: embeddedMode ?? undefined, step, name, visibleButtons });
      fail(refusal.code, refusal.message, refusal.next);
    }
    if (dataStep) await noteFallbackIfUsed(scope ?? root, dataStep);

    let label;
    try {
      label = await readAccessibleLabel(locator);
    } catch (e) {
      await browser.close();
      fail("CEREMONY_DECLINE_LABEL_UNREADABLE", `While ${step}, could not read "${name}"'s accessible label (text content, aria-label, title) to confirm it isn't a decline/reject/refuse control. Refusing to click blind rather than assuming it's safe: ${e?.message ?? e}`, [
        "Re-run with PWDEBUG=1 to watch the browser",
        "The control may have detached or changed between locating it and reading its label",
      ]);
    }
    if (!label) {
      await browser.close();
      fail("CEREMONY_DECLINE_LABEL_UNREADABLE", `While ${step}, "${name}" has no readable accessible name (no text content, aria-label, or title matched), so there is nothing to check it against before clicking. Refusing to click blind.`, [
        "Re-run with PWDEBUG=1 to watch the browser",
        "The selector may be matching the wrong control, or the control needs a readable label",
      ]);
    }
    if (DECLINE_LIKE.test(label)) {
      await browser.close();
      fail("CEREMONY_DECLINE_CONTROL_MATCHED", `While ${step}, the "${name}" selector matched a control whose accessible label reads "${label}", which reads as a decline/reject/refuse action. Refusing to click it — signing scripts must never be able to trigger a decline.`, [
        "Narrow the selector for this step; it is matching the wrong control",
      ]);
    }
    await locator.click({ timeout });
    return true;
  }

  /**
   * Checks every agreement checkbox within a container. `dataStep` selects
   * checkboxes by `[data-ceremony-step="<dataStep>"]` (the new contract —
   * `"disclosure"` or `"adopt"`), falling back to any
   * `input[type="checkbox"]` in the container for environments that don't
   * carry the attribute yet. This is a plain OR (`stepLocator`, same as
   * every other step selector below): once the new attribute is deployed,
   * the fallback half stops matching anything new — it never causes a
   * checkbox to be counted twice, since a comma-separated CSS selector list
   * already de-duplicates elements that match more than one branch.
   */
  async function checkAllCheckboxes(scopeLocator, dataStep) {
    const boxes = stepLocator(scopeLocator, dataStep, 'input[type="checkbox"]');
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      if (!(await box.isChecked().catch(() => false))) await box.check({ timeout: 5000 });
    }
    return count;
  }

  // Step 1: disclosure checkbox(es) + "Agree and Continue" — the consent
  // modal. Some ceremonies (already-consented resumes, certain embeds) skip
  // it, so its genuine absence is tolerated; but once found, "Agree and
  // Continue" must be there too. The container selector is
  // `disclosure-modal` — deliberately NOT the same value ("disclosure") as
  // the checkbox(es) inside it, which is exactly the collision that caused
  // the selector collision described in probeContainer's doc comment above.
  walkLastStep = "checking for the disclosure/consent modal";
  const consentModal = stepLocator(root, "disclosure-modal", "#concent-modal");
  const consentModalProbe = await probeContainer(consentModal, 8000);
  if (consentModalProbe.outcome === "ambiguous") {
    await browser.close();
    fail("CEREMONY_CONTAINER_AMBIGUOUS", `While checking for the disclosure/consent modal, the container selector matched more than one element (or errored) instead of exactly one: ${consentModalProbe.detail}. Refusing to guess which one is the real modal — an ambiguous match is not the same as "not on this page". Likely cause: this envelope has an initials place (or another place type) alongside or instead of a signature place — the signer UI shares contract attributes between the signature and initials modals, and this walk only ever completes envelopes whose places are signature places.`, [
      "Hand the ceremony link to a human instead (Branch A in references/verification-loop.md) — it works for every place type",
      "Re-run with PWDEBUG=1 to watch the browser",
      'The disclosure-modal contract value may now also be matching something it should not — inspect the page and narrow the selector',
    ]);
  }
  if (consentModalProbe.outcome === "present") {
    await noteFallbackIfUsed(root, "disclosure-modal");
    walkLastStep = "checking the disclosure agreement checkbox(es)";
    await checkAllCheckboxes(consentModal, "disclosure");
    await clickStep({
      step: "clicking Agree and Continue",
      locator: stepLocator(root, "disclosure-continue", "#continue-consent-button"),
      dataStep: "disclosure-continue",
      scope: root,
      name: "Agree and Continue",
      timeout: 10000,
    });
  }
  // consentModalProbe.outcome === "absent": genuinely not on this page —
  // nothing to do, and nothing was reported as satisfied for it (see
  // fallbackStepsUsed / noteFallbackIfUsed above, which was never called in
  // this branch).

  // Step 2: "Start" — begins signing / scrolls to the first place. Some
  // ceremonies open straight into the document with nothing to click here.
  await clickStep({
    step: "clicking Start",
    locator: stepLocator(root, "start", "#primary-button:visible, #primary-button-inline:visible", ":visible").first(),
    dataStep: "start",
    scope: root,
    name: "Start",
    timeout: 8000,
    required: false,
  });

  // Step 3: click the signature box (a "place") to open the adoption modal.
  await clickStep({
    step: "clicking the signature box",
    locator: stepLocator(root, "place", 'button[aria-label="Sign here"]').first(),
    dataStep: "place",
    scope: root,
    name: "signature box",
    timeout: 15000,
  });

  // Step 4: the signature adoption modal — fill the typed signature (usually
  // pre-filled with the recipient's name; fill it explicitly if it isn't),
  // check the adoption agreement checkbox, then "Adopt and Sign". The
  // container selector is `adopt-modal` — deliberately NOT `adopt`, the
  // checkbox value inside it (see the disclosure-modal comment above for
  // why that distinction matters).
  walkLastStep = "waiting for the signature adoption modal";
  const adoptionModal = stepLocator(root, "adopt-modal", "#adoption-modal");
  const adoptionModalProbe = await probeContainer(adoptionModal, 15000);
  if (adoptionModalProbe.outcome === "ambiguous") {
    await browser.close();
    fail("CEREMONY_CONTAINER_AMBIGUOUS", `While waiting for the signature adoption modal, the container selector matched more than one element (or errored) instead of exactly one: ${adoptionModalProbe.detail}. Refusing to guess which one is the real modal. Likely cause: this envelope has an initials place (or another place type) alongside or instead of a signature place — the signer UI shares contract attributes between the signature and initials modals, and this walk only ever completes envelopes whose places are signature places.`, [
      "Hand the ceremony link to a human instead (Branch A in references/verification-loop.md) — it works for every place type",
      "Re-run with PWDEBUG=1 to watch the browser",
      "The adopt-modal contract value may now also be matching something it should not — inspect the page and narrow the selector",
    ]);
  }
  if (adoptionModalProbe.outcome === "absent") {
    await browser.close();
    const refusal = stepNotFoundOutcome({
      events: deliveredEvents,
      via: embeddedMode ?? undefined,
      step: "waiting for the modal after clicking the signature box",
      name: "the signature adoption modal",
    });
    fail(refusal.code, refusal.message, refusal.next);
  }
  await noteFallbackIfUsed(root, "adopt-modal");

  walkLastStep = "filling the typed signature";
  const typedInput = stepLocator(adoptionModal, "signature-input", "#typed_symbol");
  if (await typedInput.count()) {
    await noteFallbackIfUsed(adoptionModal, "signature-input");
    const current = await typedInput.inputValue().catch(() => "");
    if (!current.trim()) {
      await typedInput.fill(targetRecipient?.name || "Signature", { timeout: 5000 });
    }
  }

  walkLastStep = "checking the signature adoption agreement checkbox(es)";
  await checkAllCheckboxes(adoptionModal, "adopt");

  await clickStep({
    step: "clicking Adopt and Sign",
    locator: stepLocator(root, "adopt-apply", "#adopt-button"),
    dataStep: "adopt-apply",
    scope: root,
    name: "Adopt and Sign",
    timeout: 10000,
  });

  walkLastStep = "waiting for the adoption modal to close";
  await adoptionModal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});

  // Step 5: "Finish" — submits the ceremony.
  await clickStep({
    step: "clicking Finish",
    locator: stepLocator(root, "finish", "#primary-button:visible, #primary-button-inline:visible", ":visible").first(),
    dataStep: "finish",
    scope: root,
    name: "Finish",
    timeout: 15000,
  });

  // Fallback: if organic input was not detected, a completion consent modal
  // appears instead of submitting directly. Standalone, confirming it is
  // itself the deliberate act. Embedded, it is refused: an embedding app's
  // signer produces real pointer input, so a walk that needs the dialog
  // did not exercise what the app's signer will see.
  const completionConsent = root.locator('[data-testid="completion-consent-confirm"]');
  if (embeddedMode) {
    walkLastStep = "checking that completion did not need the consent fallback dialog";
    const shown = await completionConsent
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      await browser.close();
      fail("ORGANIC_INPUT_NOT_ARMED", `The ceremony showed the "Confirm to continue" dialog after Finish (--embedded ${embeddedMode}). It appears when the signer UI saw no organic pointer input. Refusing to confirm it: an embedded walk must complete the way the app's signer does.`, [
        "Produce real pointer input over the ceremony before Finish (mouse movement inside the page or frame)",
        "Re-run with PWDEBUG=1 to watch where the pointer moves",
      ]);
    }
  } else {
    await clickStep({
      step: "confirming the completion consent fallback modal (if shown)",
      locator: completionConsent,
      name: "confirm",
      timeout: 4000,
      required: false,
    });
  }

  let delivery = null;
  if (embeddedMode) {
    // The event follows the result page by the ceremony's redirect_delay
    // (at most 20 seconds). Wait for the first event, then a little longer
    // so a second, unexpected event is counted too.
    walkLastStep = "waiting for the terminal ceremony event";
    const eventDeadline = Date.now() + 45000;
    while (deliveredEvents.length === 0 && Date.now() < eventDeadline) {
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(2000);
    delivery = classifyDeliveredEvents(deliveredEvents, { expected: "ceremony.completed", via: embeddedMode });
  } else {
    await page.waitForTimeout(2000);
  }
  const finalUrl = page.url();
  await browser.close();

  if (delivery && !delivery.ok) fail(delivery.code, delivery.message, delivery.next);

  // --envelope is now mandatory (see the URL_REQUIRES_ENVELOPE check above),
  // so envelopeId is always set here — there is no unverified-walk path left
  // to report through.

  // The walk finishing without a thrown error proves nothing by itself — it
  // is exactly what the original, defective version of this script reported
  // as success on. The only thing that counts is the server's own view of
  // the recipient.
  const completeTimeoutMs = timeoutSeconds * 1000;
  const result = await pollForRecipientCompletion({
    api: API,
    envelopeId,
    recipientKey: targetRecipientKey,
    key,
    timeoutMs: completeTimeoutMs,
  });

  if (result.code === "RECIPIENT_KEY_UNRESOLVED") {
    fail(
      "RECIPIENT_KEY_UNRESOLVED",
      `Could not determine which recipient's ceremony this walk drove (the ceremony_id claim in the URL's token could not be parsed), so completion cannot be verified against the right recipient. On a multi-recipient envelope, checking an arbitrary recipient instead could report "verified: true" for a walk that signed nothing — refusing to guess.`,
      [
        "Pass --recipient <key> explicitly so verification knows who to check",
        `curl -sS -H "X-API-Key: $SIGNATUREAPI_KEY" ${API}/envelopes/${envelopeId}`,
      ],
    );
  }

  if (!result.completed) {
    fail(
      "CEREMONY_WALK_DID_NOT_COMPLETE",
      `The browser walk finished (last step believed performed: "${walkLastStep}") but the recipient never reached "completed". Actual recipient status: ${result.recipient?.status ?? "unknown — envelope was not reachable while polling"}.`,
      [
        `curl -sS -H "X-API-Key: $SIGNATUREAPI_KEY" ${API}/envelopes/${envelopeId}`,
        "Re-run with PWDEBUG=1 to watch the browser and see where the walk actually diverged from the expected sequence",
        "node scripts/watch-events.mjs --envelope " + envelopeId,
      ],
    );
  }

  ok({
    walked: true,
    verified: true,
    envelope_id: envelopeId,
    envelope_status: result.envelope.status,
    recipient_key: targetRecipientKey,
    recipient_status: result.recipient.status,
    final_url: finalUrl,
    ...(delivery
      ? {
          event: delivery.event,
          ...(embeddedMode === "message" ? { rejected_messages: rejectedMessageOrigins.length } : {}),
        }
      : {}),
    // Empty once every environment ships the data-ceremony-step contract —
    // see the fallback comment above clickStep for what to remove then.
    contract_fallback_steps: fallbackStepsUsed,
    next: ["node scripts/watch-events.mjs --envelope " + envelopeId],
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Anything main() did not turn into a named refusal still leaves through
  // the fail contract, never as a raw stack trace.
  main().catch((e) => {
    fail("CEREMONY_WALK_ERROR", `The walk stopped on an unexpected error: ${e?.message ?? e}`, [
      "Re-run with PWDEBUG=1 to watch the browser",
    ]);
  });
}
