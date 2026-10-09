import { expect, test } from "@playwright/test";
import { signAndFinish } from "../support/ceremony.ts";
import { testCeremonyUrl } from "../support/signatureapi.ts";

// Needs `npx --yes signatureapi listen --forward-to http://127.0.0.1:<port>/webhooks/signatureapi`
// running, so test-mode webhooks reach the app. See e2e/README.md.

test("send an agreement, sign it, and see the webhook complete it", async ({ page }) => {
  // The name is what the recording shows as the signature; the email keeps each run's row unique.
  const email = `ana.torres+${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByLabel("Signer name").fill("Ana Torres");
  await page.getByLabel("Signer email").fill(email);
  await page.getByRole("button", { name: "Send for signature" }).click();

  const row = page.locator("tr[data-envelope-id]", { hasText: email });
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "sent");
  const envelopeId = await row.getAttribute("data-envelope-id");
  expect(envelopeId).toBeTruthy();

  await page.goto(await testCeremonyUrl(envelopeId!));
  await signAndFinish(page);

  // The page only changes when the app's webhook handler has run.
  await page.goto("/");
  await expect(async () => {
    await page.reload();
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "completed", { timeout: 1_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000] });

  const link = row.getByRole("link", { name: "Signed PDF" });
  await expect(link).toBeVisible();
  await expect(async () => {
    const res = await page.request.get((await link.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }).toPass({ timeout: 60_000, intervals: [3_000] });
});
