import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

class LocalD1Statement {
  constructor(statement, values = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.statement, values);
  }

  all() {
    return { results: this.statement.all(...this.values) };
  }

  first() {
    return this.statement.get(...this.values) || null;
  }

  run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: result };
  }
}

export class LocalD1Database {
  constructor(path = ":memory:") {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql) {
    return new LocalD1Statement(this.database.prepare(sql));
  }

  exec(sql) {
    this.database.exec(sql);
  }

  close() {
    this.database.close();
  }
}

export async function applyMigrations(db, migrationsDir) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const applied = db.prepare("SELECT filename FROM schema_migrations WHERE filename = ?").bind(file).first();
    if (applied) continue;
    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (filename, applied_at) VALUES (?, CURRENT_TIMESTAMP)").bind(file).run();
  }
  return files;
}
