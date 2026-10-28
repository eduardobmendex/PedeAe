// Aplica as migrations pendentes no banco definido em DATABASE_URL (.env).
import "dotenv/config";
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida no .env");
  process.exit(1);
}

const { status } = spawnSync("npx", ["supabase", "db", "push", "--db-url", process.env.DATABASE_URL, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(status ?? 1);
