import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { persistGateA3Checkpoint, writeGateA3Reports, DEFAULT_GATE_A3_PATHS } from "../src/facebook-gate-a3-persistence.mjs";
import { applyMigrations, LocalD1Database } from "../src/local-d1-sqlite.mjs";
import { D1IntelligenceStore } from "../src/intelligence-server.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dbPath = resolve(process.argv[2] || resolve(projectRoot, "research/facebook-collections/gate-a3-local-d1.sqlite"));
const checkpointPath = resolve(process.argv[3] || DEFAULT_GATE_A3_PATHS.checkpoint);

await mkdir(dirname(dbPath), { recursive: true });
const db = new LocalD1Database(dbPath);
try {
  const migrations = await applyMigrations(db, resolve(projectRoot, "db/migrations"));
  const store = new D1IntelligenceStore(db);
  const reconciliation = await persistGateA3Checkpoint(store, { checkpointPath });
  const reports = await writeGateA3Reports(reconciliation);
  console.log(JSON.stringify({
    ok: true,
    db_path: dbPath,
    checkpoint_path: checkpointPath,
    migrations_applied_or_verified: migrations.length,
    report_path: reports.reportPath,
    reconciliation_path: reports.reconciliationPath,
    canonical_posts: reconciliation.canonical_posts,
    metric_snapshots: reconciliation.metric_snapshots,
    raw_observations: reconciliation.raw_observations,
    quality: reconciliation.quality,
    production_d1_touched: reconciliation.production_d1_touched,
    deployment_performed: reconciliation.deployment_performed
  }, null, 2));
} finally {
  db.close();
}
