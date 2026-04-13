/**
 * Local SQLite database — offline-first storage.
 * Mirrors knowledge items and query history on device.
 * Syncs with backend when online.
 *
 * Tables:
 *   knowledge_items  — cached/offline knowledge
 *   query_history    — local query history
 *   sync_queue       — pending writes to push to server
 */
import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync('translan_local.db');
    await initSchema(_db);
  }
  return _db;
}

async function initSchema(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id          INTEGER PRIMARY KEY,
      server_id   INTEGER UNIQUE,
      title       TEXT NOT NULL,
      content     TEXT DEFAULT '',
      summary     TEXT DEFAULT '',
      category    TEXT DEFAULT 'General',
      tags        TEXT DEFAULT '[]',
      source_type TEXT DEFAULT 'manual',
      is_public   INTEGER DEFAULT 0,
      price       REAL DEFAULT 0,
      synced      INTEGER DEFAULT 1,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS query_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id  INTEGER UNIQUE,
      query_text TEXT NOT NULL,
      answer_text TEXT DEFAULT '',
      sources    TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      entity     TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Knowledge Items ───────────────────────────────────────────────────────────

export async function saveKnowledgeLocal(item: {
  server_id?: number;
  title: string;
  content: string;
  summary?: string;
  category?: string;
  tags?: string[];
  source_type?: string;
  is_public?: boolean;
  price?: number;
  updated_at?: string;
  synced?: boolean;
}) {
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO knowledge_items
      (server_id, title, content, summary, category, tags, source_type, is_public, price, synced, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.server_id ?? null,
      item.title,
      item.content,
      item.summary ?? '',
      item.category ?? 'General',
      JSON.stringify(item.tags ?? []),
      item.source_type ?? 'manual',
      item.is_public ? 1 : 0,
      item.price ?? 0,
      item.synced !== false ? 1 : 0,
      item.updated_at ?? new Date().toISOString(),
    ]
  );
}

export async function getKnowledgeLocal(search?: string): Promise<any[]> {
  const db = await getDB();
  const rows = search
    ? await db.getAllAsync<any>(
        `SELECT * FROM knowledge_items WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC`,
        [`%${search}%`, `%${search}%`]
      )
    : await db.getAllAsync<any>(`SELECT * FROM knowledge_items ORDER BY updated_at DESC`);

  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]'), is_public: !!r.is_public }));
}

export async function deleteKnowledgeLocal(serverId: number) {
  const db = await getDB();
  await db.runAsync(`DELETE FROM knowledge_items WHERE server_id = ?`, [serverId]);
}

// ── Query History ─────────────────────────────────────────────────────────────

export async function saveQueryLocal(item: {
  server_id?: number;
  query_text: string;
  answer_text: string;
  sources?: any[];
}) {
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO query_history (server_id, query_text, answer_text, sources)
     VALUES (?, ?, ?, ?)`,
    [item.server_id ?? null, item.query_text, item.answer_text, JSON.stringify(item.sources ?? [])]
  );
}

export async function getQueryHistoryLocal(limit = 20): Promise<any[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({ ...r, sources: JSON.parse(r.sources || '[]') }));
}

// ── Sync Queue ────────────────────────────────────────────────────────────────

export async function queueSync(action: string, entity: string, payload: object) {
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO sync_queue (action, entity, payload) VALUES (?, ?, ?)`,
    [action, entity, JSON.stringify(payload)]
  );
}

export async function getPendingSync(): Promise<any[]> {
  const db = await getDB();
  return db.getAllAsync<any>(`SELECT * FROM sync_queue ORDER BY created_at ASC`);
}

export async function clearSyncItem(id: number) {
  const db = await getDB();
  await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
}
