import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "shipyard.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      sha TEXT NOT NULL,
      branch TEXT NOT NULL,
      message TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      committed_at TEXT NOT NULL DEFAULT '',
      processed_at TEXT NOT NULL,
      UNIQUE(repo, sha)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id INTEGER NOT NULL,
      card_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(commit_id) REFERENCES processed_commits(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_cursors (
      repo TEXT PRIMARY KEY,
      last_sha TEXT,
      last_polled_at TEXT
    );
  `);

  const eventColumns = database.prepare("PRAGMA table_info(events)").all() as {
    name: string;
  }[];
  if (!eventColumns.some((column) => column.name === "commit_id")) {
    database.exec("ALTER TABLE events ADD COLUMN commit_id INTEGER");
  }
}

export function nowIso() {
  return new Date().toISOString();
}
