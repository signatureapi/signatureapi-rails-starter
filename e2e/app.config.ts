/**
 * The only file that differs between framework repos: how to start this
 * repo's app and where its env file lives. Everything else in e2e/ is shared.
 */

/** Port the app listens on: 3000, or E2E_PORT when 3000 is taken. Must match the `signatureapi listen --forward-to` target. */
const port = Number(process.env.E2E_PORT ?? 3000);

export const app = {
  /** Shell command that starts the app on `port`. Runs in `cwd`. */
  command: `bin/rails server -p ${port}`,
  /** Directory the command runs in, relative to e2e/. */
  cwd: "..",
  /** Env file holding SIGNATUREAPI_KEY and SIGNATUREAPI_WEBHOOK_SECRET, relative to e2e/. */
  envFile: "../.env",
  port,
  /** Extra env for the command (the port variable name differs per framework). */
  env: { PORT: String(port) } as Record<string, string>,
};
