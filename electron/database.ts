import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

type SqlValue = string | number | null | Uint8Array;
type Row = Record<string, unknown>;

interface SqlStatement {
  bind(values?: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Row;
  free(): void;
}

interface SqlDatabase {
  run(sql: string, values?: SqlValue[]): SqlDatabase;
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

const requireFromHere = createRequire(__filename);

export class DatabaseStore {
  private db!: SqlDatabase;
  private readonly filePath: string;
  private flushQueue: Promise<void> = Promise.resolve();

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static async open(filePath: string): Promise<DatabaseStore> {
    const store = new DatabaseStore(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let prior: Uint8Array | undefined;
    try {
      prior = new Uint8Array(await fs.readFile(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const Sql = await (initSqlJs as unknown as (options: { locateFile: (file: string) => string }) => Promise<SqlModule>)({
      locateFile: (file) => path.join(path.dirname(requireFromHere.resolve('sql.js')), file),
    });
    store.db = new Sql.Database(prior);
    store.migrate();
    await store.flush();
    return store;
  }

  private migrate(): void {
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_ms INTEGER,
        source TEXT NOT NULL,
        provider TEXT,
        account_id TEXT,
        job_id TEXT,
        prompt TEXT,
        model TEXT,
        source_asset_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        delete_batch_id TEXT
      );
      CREATE INDEX IF NOT EXISTS assets_recent_idx ON assets(created_at DESC);
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        portrait_asset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS character_references (
        character_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        PRIMARY KEY (character_id, asset_id),
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS asset_characters (
        asset_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        PRIMARY KEY (asset_id, character_id),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        character_id TEXT,
        input_asset_ids TEXT NOT NULL DEFAULT '[]',
        output_asset_ids TEXT NOT NULL DEFAULT '[]',
        model_id TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL,
        output_count INTEGER NOT NULL DEFAULT 1,
        account_id TEXT,
        provider TEXT NOT NULL DEFAULT 'mock',
        error TEXT,
        retry_of_job_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        progress_started_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS jobs_recent_idx ON jobs(created_at DESC);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        connection TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  run(sql: string, values: SqlValue[] = []): void {
    this.db.run(sql, values);
  }

  all<T extends Row = Row>(sql: string, values: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(values);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  one<T extends Row = Row>(sql: string, values: SqlValue[] = []): T | null {
    return this.all<T>(sql, values)[0] ?? null;
  }

  setting<T>(key: string, fallback: T): T {
    const row = this.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  transaction<T>(work: () => T): T {
    this.db.run('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.run('COMMIT');
      return value;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  async flush(): Promise<void> {
    const data = Buffer.from(this.db.export());
    const tmpPath = `${this.filePath}.tmp`;
    const prior = this.flushQueue.catch(() => undefined);
    this.flushQueue = prior.then(async () => {
      await fs.writeFile(tmpPath, data);
      await fs.rename(tmpPath, this.filePath);
    });
    await this.flushQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.flushQueue;
    this.db.close();
  }
}
