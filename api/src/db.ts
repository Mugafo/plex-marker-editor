import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const LOG = '[plex-marker-editor:db]';

function logDb(message: string, extra?: Record<string, unknown>): void {
  if (extra && Object.keys(extra).length > 0) {
    // Single line so Docker Compose does not merge stdout with other services mid-object.
    console.log(`${LOG} ${message} ${JSON.stringify(extra)}`);
  } else {
    console.log(`${LOG} ${message}`);
  }
}

function sqliteErrorUserHint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('disk i/o') || m.includes('i/o error')) {
    return (
      ' Common causes: (1) Plex still has the DB open—stop Plex and retry. ' +
      '(2) Docker Desktop on Windows bind-mounting the live Plex folder—SQLite + WAL often fails there; ' +
      'copy com.plexapp.plugins.library.db (and .db-wal / .db-shm if they exist) into the repo ./data folder with PLEX_DATA_HOST_PATH=./data, or run Docker from WSL and mount a path on the Linux filesystem. ' +
      '(3) Disk full or hardware errors on the host.'
    );
  }
  return '';
}

export type DbInitState = {
  path: string;
  connected: boolean;
  /** Present when `connected` is false */
  error: string | null;
  isLegacyExtraData: boolean;
  /** SQLite marker tag id when connected */
  markerTagId: number;
  /** True when a path was configured but that file does not exist on disk */
  fileMissing: boolean;
};

const configuredPath = (process.env.PLEX_DB_PATH ?? '').trim();

let db: Database | null = null;
let initState: DbInitState = {
  path: configuredPath || '(not set)',
  connected: false,
  error: null,
  isLegacyExtraData: false,
  markerTagId: 0,
  fileMissing: false,
};

function tryOpen(): void {
  logDb('startup', {
    PLEX_DB_PATH_raw: configuredPath || '(empty)',
    cwd: process.cwd(),
  });

  if (!configuredPath) {
    initState = {
      path: '(not set)',
      connected: false,
      error: 'Set PLEX_DB_PATH to your Plex library database file (e.g. com.plexapp.plugins.library.db).',
      isLegacyExtraData: false,
      markerTagId: 0,
      fileMissing: false,
    };
    logDb('not opening: PLEX_DB_PATH is not set');
    return;
  }

  const abs = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(process.cwd(), configuredPath);
  logDb('resolved path', { absolute: abs });

  if (!fs.existsSync(abs)) {
    const parent = path.dirname(abs);
    let parentHint: string | undefined;
    try {
      if (fs.existsSync(parent)) {
        const names = fs.readdirSync(parent);
        parentHint = `parent directory exists; ${names.length} entries (showing up to 30): ${names.slice(0, 30).join(', ')}`;
      } else {
        parentHint = 'parent directory does not exist';
      }
    } catch (e) {
      parentHint = `could not read parent: ${e instanceof Error ? e.message : String(e)}`;
    }
    logDb('file missing on disk', { absolute: abs, parent, parentHint });
    initState = {
      path: abs,
      connected: false,
      error: `Database file not found: ${abs}`,
      isLegacyExtraData: false,
      markerTagId: 0,
      fileMissing: true,
    };
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    logDb('stat failed before open', {
      absolute: abs,
      err: e instanceof Error ? e.message : String(e),
    });
    initState = {
      path: abs,
      connected: false,
      error: e instanceof Error ? e.message : String(e),
      isLegacyExtraData: false,
      markerTagId: 0,
      fileMissing: false,
    };
    return;
  }
  logDb('file present', {
    absolute: abs,
    sizeBytes: stat.size,
    mode: stat.mode.toString(8),
    isFile: stat.isFile(),
  });

  try {
    logDb('opening SQLite…', { absolute: abs });
    const next = new Database(abs);
    const row = next.prepare('SELECT id FROM tags WHERE tag_type = 12 LIMIT 1').get() as { id?: unknown } | undefined;
    const tagId = row?.id != null ? Number(row.id) : NaN;
    if (!Number.isFinite(tagId)) {
      next.close();
      logDb('rejecting file: no Plex marker tag (tag_type = 12)', {
        absolute: abs,
        tagsRow: row ?? null,
      });
      initState = {
        path: abs,
        connected: false,
        error:
          'This file does not look like a Plex library database (no marker tag). ' +
          'Point PLEX_DB_PATH at com.plexapp.plugins.library.db from your Plex metadata folder.',
        isLegacyExtraData: false,
        markerTagId: 0,
        fileMissing: false,
      };
      return;
    }

    const sample = next.prepare('SELECT extra_data FROM taggings WHERE tag_id = ? LIMIT 1').get(tagId) as
      | { extra_data?: unknown }
      | undefined;
    let isLegacy = false;
    if (sample?.extra_data != null) {
      const s = String(sample.extra_data);
      if (s.length > 0 && s[0] !== '{') {
        isLegacy = true;
      }
    }

    if (db) {
      db.close();
    }
    db = next;
    initState = {
      path: abs,
      connected: true,
      error: null,
      isLegacyExtraData: isLegacy,
      markerTagId: tagId,
      fileMissing: false,
    };
    let writable = false;
    try {
      fs.accessSync(abs, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    logDb('connected', {
      absolute: abs,
      markerTagId: tagId,
      isLegacyExtraData: isLegacy,
      writable,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logDb('SQLite open or probe failed', {
      absolute: abs,
      message: err.message,
      name: err.name,
      stack: err.stack,
    });
    const baseMsg = e instanceof Error ? e.message : String(e);
    const hint = sqliteErrorUserHint(baseMsg);
    if (hint) {
      logDb('hint for SQLite error', { hint: hint.trim() });
    }
    initState = {
      path: abs,
      connected: false,
      error: baseMsg + hint,
      isLegacyExtraData: false,
      markerTagId: 0,
      fileMissing: false,
    };
  }
}

tryOpen();

export function getDb(): Database | null {
  return db;
}

export function getDbState(): DbInitState {
  return initState;
}

export function isDbWritable(): boolean {
  const p = initState.path;
  if (!initState.connected || !p || p === '(not set)') {
    return false;
  }
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
