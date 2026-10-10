import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export class Storage {
  constructor(root) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, 'bridge.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, input TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);`);
    this.db.prepare("UPDATE jobs SET state='outcome_unknown', error=? WHERE state IN ('accepted','validated','queued','executing')")
      .run(JSON.stringify({ code: 'OUTCOME_UNKNOWN', message: 'Service restarted while work was in flight; inspect AE before retrying' }));
  }
  createJob(id, kind, input) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)').run(id, kind, 'accepted', JSON.stringify(input), now, now);
    return this.job(id);
  }
  job(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    return row && { id: row.id, kind: row.kind, state: row.state, input: JSON.parse(row.input), result: row.result && JSON.parse(row.result), error: row.error && JSON.parse(row.error), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  updateJob(id, state, value = null) {
    const field = state === 'failed' || state === 'outcome_unknown' ? 'error' : 'result';
    this.db.prepare(`UPDATE jobs SET state=?, ${field}=?, updated_at=? WHERE id=?`).run(state, value && JSON.stringify(value), new Date().toISOString(), id);
    return this.job(id);
  }
  addArtifact(id, kind, path, metadata) {
    this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?)').run(id, kind, path, JSON.stringify(metadata), new Date().toISOString());
    return this.artifact(id);
  }
  artifact(id) {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id);
    return row && { id: row.id, kind: row.kind, path: row.path, metadata: JSON.parse(row.metadata), createdAt: row.created_at };
  }
  recentArtifacts(limit = 8) {
    return this.db.prepare('SELECT id,kind,metadata,created_at FROM artifacts ORDER BY created_at DESC LIMIT ?').all(limit).map(x => ({ id:x.id, kind:x.kind, metadata:JSON.parse(x.metadata), createdAt:x.created_at }));
  }
}
