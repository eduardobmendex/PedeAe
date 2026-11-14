import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

// Testes de ponta a ponta (e2e/). Rodam contra o app em E2E_BASE_URL e criam dados
// descartáveis no banco de DATABASE_URL (apagados ao final de cada teste).
//
// Local:  npm run test:e2e            (usa o `next dev` já aberto em :3000, ou sobe um)
// CI:     o workflow faz build + start e passa CI=1.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Bahia",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      // Local: Chrome instalado na máquina. CI: Chromium baixado pelo Playwright.
      use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) },
    },
  ],
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
