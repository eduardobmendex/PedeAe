// Extrai "create function <name>(...) ... $$;" de um arquivo de migration.
import { readFileSync } from "node:fs";
export function extractFunction(file, name) {
  const sql = readFileSync(file, "utf8");
  const start = sql.indexOf(`create function ${name}(`);
  if (start < 0) throw new Error(`${name} não encontrada em ${file}`);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$;", bodyStart + 2);
  return sql.slice(start, bodyEnd + 3).replace(/^create function/, "create or replace function");
}
