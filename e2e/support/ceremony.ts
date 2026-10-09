import type { Page } from "@playwright/test";

// The signing ceremony at sign.signatureapi.com, opened as a top-level page.

export async function signAndFinish(page: Page) {
  await page.getByRole("dialog", { name: "Consent to continue" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and Continue" }).click();
  await page.getByRole("button", { name: "Sign here" }).click();
  const dialog = page.getByRole("dialog", { name: "Please provide your signature" });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Adopt and Sign" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  // Finish submits in the background; leaving before this page appears cancels the signature.
  await page.getByText("You signed this document").waitFor();
}
