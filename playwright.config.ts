import { defineConfig, devices } from "@playwright/test";

// The suite starts its own server on port 3311 against a fresh database in
// test-results/ (scripts/e2e-server.ts), so it never touches
// data/forecraft.db.
// E2E_PORT lets several runs share a checkout (each gets its own server,
// database and output directory).
const PORT = Number(process.env.E2E_PORT ?? 3311);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: PORT === 3311 ? "test-results" : `test-results-${PORT}`,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-server.ts",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), E2E_DB: PORT === 3311 ? "test-results/e2e.db" : `test-results-${PORT}/e2e.db` },
    timeout: 30_000,
  },
});
