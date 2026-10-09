import { defineConfig, devices } from "@playwright/test";
import { app } from "./app.config.ts";

/**
 * One real flow against SignatureAPI test mode: the app creates the envelope,
 * a test-only ceremony stands in for the signing email, and the app's webhook
 * marks the agreement completed. `npm run record` sets RECORD=1 to keep a video.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${app.port}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
    video: process.env.RECORD ? { mode: "on", size: { width: 1280, height: 800 } } : "off",
    launchOptions: process.env.RECORD ? { slowMo: 250 } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: app.command,
    cwd: app.cwd,
    env: app.env,
    url: `http://localhost:${app.port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
