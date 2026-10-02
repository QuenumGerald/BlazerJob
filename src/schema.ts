import Database from 'better-sqlite3';

const EXTRA_COLUMNS: Array<[string, string]> = [
  ['lastError', 'TEXT'],
  ['webhookUrl', 'TEXT'],
  ['handler_name', 'TEXT'],
  ['payload', 'TEXT'],
  ['result_json', 'TEXT'],
  ['error_json', 'TEXT'],
  ['attempt_count', 'INTEGER DEFAULT 0'],
  ['max_attempts', 'INTEGER'],
  ['timeout_ms', 'INTEGER'],
  ['max_duration_ms', 'INTEGER'],
  ['max_runs', 'INTEGER'],
  ['run_count', 'INTEGER DEFAULT 0'],
  ['error_count', 'INTEGER DEFAULT 0'],
  ['started_at', 'TEXT'],
  ['lease_until', 'TEXT'],
  ['worker_id', 'TEXT'],
  ['backoff_until', 'TEXT'],
  ['resumable', 'INTEGER DEFAULT 1'],
  ['retry_policy', 'TEXT'],
  ['backoff_ms', 'INTEGER'],
  ['backoff_multiplier', 'REAL'],
  ['jitter', 'REAL'],
  ['result_stored_at', 'TEXT']
];

export function migrateSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runAt TEXT,
      interval INTEGER,
      priority INTEGER,
      retriesLeft INTEGER,
      type TEXT,
      config TEXT,
      webhookUrl TEXT,
      status TEXT DEFAULT 'pending',
      executed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      lastError TEXT
    )
  `);
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>).map((c) => c.name)
  );
  for (const [name, type] of EXTRA_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
    }
  }
}
