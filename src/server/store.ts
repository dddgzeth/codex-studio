import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type StoredThread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  status: string;
  updatedAt: number;
  rawThread: string;
};

export class AppStore {
  private readonly db: Database.Database;

  constructor(baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
    this.db = new Database(path.join(baseDir, "app.db"));
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_cache (
        id TEXT PRIMARY KEY,
        name TEXT,
        preview TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        raw_thread TEXT NOT NULL,
        synced_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        method TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        format TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_mapping (
        original_id TEXT PRIMARY KEY,
        active_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  saveThread(thread: unknown & { id: string; name: string | null; preview: string; cwd: string; updatedAt: number; status: unknown }) {
    this.db
      .prepare(`
        INSERT INTO thread_cache (id, name, preview, cwd, status, updated_at, raw_thread, synced_at)
        VALUES (@id, @name, @preview, @cwd, @status, @updatedAt, @rawThread, @syncedAt)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          preview = excluded.preview,
          cwd = excluded.cwd,
          status = excluded.status,
          updated_at = excluded.updated_at,
          raw_thread = excluded.raw_thread,
          synced_at = excluded.synced_at
      `)
      .run({
        id: thread.id,
        name: thread.name,
        preview: thread.preview,
        cwd: thread.cwd,
        status: JSON.stringify(thread.status),
        updatedAt: thread.updatedAt,
        rawThread: JSON.stringify(thread),
        syncedAt: Date.now()
      });
  }

  deleteThread(threadId: string) {
    this.db.prepare(`DELETE FROM thread_cache WHERE id = ?`).run(threadId);
  }

  getCachedThreads(): StoredThread[] {
    return this.db
      .prepare(`
        SELECT id, name, preview, cwd, status, updated_at AS updatedAt, raw_thread AS rawThread
        FROM thread_cache
        ORDER BY updated_at DESC
      `)
      .all() as StoredThread[];
  }

  logEvent(threadId: string, method: string, payload: unknown) {
    this.db
      .prepare(`
        INSERT INTO event_log (thread_id, method, payload, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(threadId, method, JSON.stringify(payload), Date.now());
  }

  getRecentEvents(threadId: string, limit = 20) {
    return this.db
      .prepare(`
        SELECT method, payload, created_at AS createdAt
        FROM event_log
        WHERE thread_id = ?
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(threadId, limit) as Array<{ method: string; payload: string; createdAt: number }>;
  }

  getThread(id: string): StoredThread | undefined {
    return this.db
      .prepare(`SELECT id, name, preview, cwd, status, updated_at AS updatedAt, raw_thread AS rawThread FROM thread_cache WHERE id = ?`)
      .get(id) as StoredThread | undefined;
  }

  getThreadMapping(originalId: string): string | null {
    const row = this.db
      .prepare(`SELECT active_id FROM thread_mapping WHERE original_id = ?`)
      .get(originalId) as { active_id: string } | undefined;
    return row?.active_id ?? null;
  }

  getOriginalId(activeId: string): string | null {
    const row = this.db
      .prepare(`SELECT original_id FROM thread_mapping WHERE active_id = ?`)
      .get(activeId) as { original_id: string } | undefined;
    return row?.original_id ?? null;
  }

  getMappedActiveIds(): Set<string> {
    const rows = this.db
      .prepare(`SELECT active_id FROM thread_mapping`)
      .all() as Array<{ active_id: string }>;
    return new Set(rows.map((r) => r.active_id));
  }

  setThreadMapping(originalId: string, activeId: string) {
    this.db
      .prepare(`
        INSERT INTO thread_mapping (original_id, active_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(original_id) DO UPDATE SET active_id = excluded.active_id, updated_at = excluded.updated_at
      `)
      .run(originalId, activeId, Date.now());
  }

  clearThreadMapping(originalId: string) {
    this.db.prepare(`DELETE FROM thread_mapping WHERE original_id = ?`).run(originalId);
  }

  recordExport(threadId: string, format: string, filePath: string) {
    this.db
      .prepare(`
        INSERT INTO exports (thread_id, format, file_path, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(threadId, format, filePath, Date.now());
  }
}
