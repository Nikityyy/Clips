import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseStore } from '../electron/database';

let workingDirectory: string | undefined;
let database: DatabaseStore | undefined;

afterEach(async () => {
  if (database) await database.close();
  database = undefined;
  if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  workingDirectory = undefined;
});

describe('local database', () => {
  it('creates its schema and preserves settings across a restart', async () => {
    workingDirectory = await mkdtemp(path.join(tmpdir(), 'clips-db-'));
    const databasePath = path.join(workingDirectory, 'clips.sqlite');
    database = await DatabaseStore.open(databasePath);
    expect(database.setting('locale', 'en')).toBe('en');
    database.setSetting('locale', 'de');
    database.setSetting('panelWidths', { prompt: 296, inspector: 272 });
    await database.close();
    database = await DatabaseStore.open(databasePath);

    expect(database.setting('locale', 'en')).toBe('de');
    expect(database.setting('panelWidths', {})).toEqual({ prompt: 296, inspector: 272 });
  });
});
