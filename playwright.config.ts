import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "@playwright/test";

// End-to-end tests run the real app against a throwaway in-memory Postgres and
// a fake GitHub API. `npm run test:e2e` starts all servers; stop any other
// `next dev` in this folder first.
const DB_PORT = 55433;
const APP_PORT = 3101;
const GITHUB_PORT = 55434;
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@localhost:${DB_PORT}/postgres`;
export const FAKE_GITHUB_URL = `http://localhost:${GITHUB_PORT}`;
export const E2E_WEBHOOK_SECRET = "e2e-webhook-secret";

// Octokit signs App JWTs locally, so it needs a real key; the fake never checks it.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    // Uses the installed Chrome; no Playwright browser download needed.
    channel: process.env.PW_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx scripts/db-local.mts",
      env: { PGLITE_PORT: String(DB_PORT), PGLITE_DIR: "memory://" },
      port: DB_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx tsx e2e/fake-github.mts",
      env: { FAKE_GITHUB_PORT: String(GITHUB_PORT) },
      port: GITHUB_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx next dev -p ${APP_PORT}`,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        AUTH_SECRET: "e2e-only-secret-not-for-production",
        AUTH_DEV_LOGIN: "e2e-owner",
        AUTH_TRUST_HOST: "true",
        OWNER_GITHUB_LOGINS: "e2e-owner",
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: privateKey,
        GITHUB_APP_SLUG: "agentplanner-e2e",
        GITHUB_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
        GITHUB_API_URL: FAKE_GITHUB_URL,
      },
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
