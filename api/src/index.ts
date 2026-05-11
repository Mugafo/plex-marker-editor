import cors from 'cors';
import express from 'express';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { getDb, getDbState, isDbWritable } from './db.js';
import {
  deleteMarker,
  fetchEpisodesForSeason,
  fetchIntroCreditsMarkersForItem,
  fetchLibraries,
  fetchMoviesForLibrary,
  fetchSeasonsForShow,
  fetchShowsForLibrary,
  insertMarker,
  swapMarkerOrder,
  updateMarker,
  type MarkerKind,
} from './plexQueries.js';
import { normalizeRoutePath, resolveRouteFromDb } from './routeResolve.js';

const PORT = Number(process.env.PORT) || 3101;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

function requireDb(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const db = getDb();
  if (!db) {
    const st = getDbState();
    res.status(503).json({
      error: 'Database not available',
      detail: st.error ?? 'Not connected',
    });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  const st = getDbState();
  const writable = isDbWritable();
  res.json({
    ok: true,
    service: 'plex-marker-editor-api',
    database: {
      path: st.path,
      connected: st.connected,
      writable: st.connected ? writable : false,
      isLegacyExtraData: st.isLegacyExtraData,
      error: st.error,
      fileMissing: st.fileMissing,
    },
  });
});

app.get('/api/route-resolve', requireDb, (req, res) => {
  const db = getDb()!;
  const raw = typeof req.query.path === 'string' ? req.query.path : '';
  const snapshot = resolveRouteFromDb(db, raw || '/');
  res.json(snapshot);
});

app.get('/api/libraries', requireDb, (_req, res) => {
  const db = getDb()!;
  res.json(fetchLibraries(db));
});

app.get('/api/libraries/:sectionId/movies', requireDb, (req, res) => {
  const db = getDb()!;
  const id = Number(req.params.sectionId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid section id' });
    return;
  }
  res.json(fetchMoviesForLibrary(db, id));
});

app.get('/api/libraries/:sectionId/shows', requireDb, (req, res) => {
  const db = getDb()!;
  const id = Number(req.params.sectionId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid section id' });
    return;
  }
  res.json(fetchShowsForLibrary(db, id));
});

app.get('/api/shows/:showId/seasons', requireDb, (req, res) => {
  const db = getDb()!;
  const id = Number(req.params.showId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid show id' });
    return;
  }
  res.json(fetchSeasonsForShow(db, id));
});

app.get('/api/seasons/:seasonId/episodes', requireDb, (req, res) => {
  const db = getDb()!;
  const id = Number(req.params.seasonId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid season id' });
    return;
  }
  res.json(fetchEpisodesForSeason(db, id));
});

app.get('/api/items/:metadataItemId/markers', requireDb, (req, res) => {
  const db = getDb()!;
  const st = getDbState();
  const metaId = Number(req.params.metadataItemId);
  if (!Number.isFinite(metaId)) {
    res.status(400).json({ error: 'Invalid metadata item id' });
    return;
  }
  res.json(fetchIntroCreditsMarkersForItem(db, st.markerTagId, metaId));
});

app.patch('/api/markers/:id', requireDb, (req, res) => {
  const db = getDb()!;
  const st = getDbState();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid marker id' });
    return;
  }
  const body = req.body as {
    index?: unknown;
    marker_type?: unknown;
    start_ms?: unknown;
    end_ms?: unknown;
    credits_final?: unknown;
  };
  const index = Number(body.index);
  const marker_type = body.marker_type === 'intro' || body.marker_type === 'credits' ? body.marker_type : null;
  const start_ms = Number(body.start_ms);
  const end_ms = Number(body.end_ms);
  const credits_final = Boolean(body.credits_final);
  if (!marker_type || !Number.isFinite(index) || !Number.isFinite(start_ms) || !Number.isFinite(end_ms)) {
    res.status(400).json({ error: 'Invalid body: need index, marker_type, start_ms, end_ms' });
    return;
  }
  try {
    updateMarker(
      db,
      { id, index, marker_type, start_ms, end_ms },
      credits_final,
      st.isLegacyExtraData,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/markers/:id', requireDb, (req, res) => {
  const db = getDb()!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid marker id' });
    return;
  }
  try {
    deleteMarker(db, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/markers/swap', requireDb, (req, res) => {
  const db = getDb()!;
  const body = req.body as { id_a?: unknown; id_b?: unknown };
  const idA = Number(body.id_a);
  const idB = Number(body.id_b);
  if (!Number.isFinite(idA) || !Number.isFinite(idB)) {
    res.status(400).json({ error: 'Need id_a and id_b' });
    return;
  }
  try {
    swapMarkerOrder(db, idA, idB);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/items/:metadataItemId/markers', requireDb, (req, res) => {
  const db = getDb()!;
  const st = getDbState();
  const metaId = Number(req.params.metadataItemId);
  if (!Number.isFinite(metaId)) {
    res.status(400).json({ error: 'Invalid metadata item id' });
    return;
  }
  const body = req.body as {
    marker_type?: unknown;
    start_ms?: unknown;
    end_ms?: unknown;
    credits_final?: unknown;
  };
  const marker_type =
    body.marker_type === 'intro' || body.marker_type === 'credits' ? (body.marker_type as MarkerKind) : null;
  const start_ms = Number(body.start_ms);
  const end_ms = Number(body.end_ms);
  const credits_final = Boolean(body.credits_final);
  if (!marker_type || !Number.isFinite(start_ms) || !Number.isFinite(end_ms)) {
    res.status(400).json({ error: 'Invalid body: need marker_type, start_ms, end_ms' });
    return;
  }
  try {
    insertMarker(db, st.markerTagId, metaId, marker_type, start_ms, end_ms, credits_final, st.isLegacyExtraData);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/export', requireDb, (_req, res) => {
  const st = getDbState();
  if (!st.connected || !existsSync(st.path)) {
    res.status(404).json({ error: 'Database file missing' });
    return;
  }
  const base = path.basename(st.path);
  const filename = base.endsWith('.db') ? base.replace(/\.db$/i, '-edited.db') : `${base}-edited`;
  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  createReadStream(st.path).pipe(res);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  const st = getDbState();
  console.log(`[plex-marker-editor:api] listening on port ${PORT}`);
  console.log(
    `[plex-marker-editor:api] database connected=${st.connected} path=${st.path} ${JSON.stringify({
      writable: st.connected ? isDbWritable() : false,
      fileMissing: st.fileMissing,
      error: st.error,
    })}`,
  );
});
