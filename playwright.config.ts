import { defineConfig, devices } from "@playwright/test";

// The suite starts its own server on port 3311 against a fresh database in
// test-results/ (scripts/e2e-server.ts), so it never touches
// data/forecraft.db.
const PORT = 3311;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-server.ts",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
    timeout: 30_000,
  },
});
