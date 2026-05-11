import type Database from 'better-sqlite3';

export type MarkerKind = 'intro' | 'credits';

export type MarkerRow = {
  id: number;
  metadata_item_id: number;
  index: number;
  marker_type: MarkerKind;
  start_ms: number;
  end_ms: number;
  extra_data: string | null;
  metadata_type: number;
  item_title: string;
  library_name: string;
  season_title: string | null;
  show_title: string | null;
};

export type LibraryRow = {
  id: number;
  type: 1 | 2;
  name: string;
};

export type MovieListRow = {
  id: number;
  title: string;
  year: number | null;
  duration: number | null;
};

export type ShowListRow = {
  id: number;
  title: string;
  season_count: number;
  episode_count: number;
};

export type SeasonListRow = {
  id: number;
  title: string;
  index: number;
  episode_count: number;
};

export type EpisodeListRow = {
  id: number;
  title: string;
  index: number;
  season: string;
  season_index: number;
  show: string;
  duration: number;
};

export function buildExtraData(markerType: MarkerKind, final: boolean, isLegacy: boolean): string | null {
  if (markerType === 'intro') {
    return isLegacy ? 'pv%3Aversion=5' : '{"pv:version":"5","url":"pv%3Aversion=5"}';
  }
  if (final) {
    return isLegacy ? 'pv%3Afinal=1&pv%3Aversion=4' : '{"pv:final":"1","pv:version":"4","url":"pv%3Afinal=1&pv%3Aversion=4"}';
  }
  return isLegacy ? 'pv%3Aversion=4' : '{"pv:version":"4","url":"pv%3Aversion=4"}';
}

function runFirstCell(db: Database, sql: string, params: unknown[]): unknown {
  const stmt = db.prepare(sql);
  const row = stmt.get(...params) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }
  const keys = Object.keys(row);
  return keys.length ? row[keys[0]!] : undefined;
}

export function fetchLibraries(db: Database): LibraryRow[] {
  const sql = `
    SELECT id, section_type AS type, name
    FROM library_sections
    WHERE section_type IN (1, 2)
    ORDER BY name COLLATE NOCASE;
  `;
  const rows = db.prepare(sql).all() as { id: number; type: number; name: string }[];
  return rows
    .filter((r) => r.type === 1 || r.type === 2)
    .map((r) => ({
      id: Number(r.id),
      type: r.type as 1 | 2,
      name: String(r.name ?? ''),
    }));
}

export function fetchMoviesForLibrary(db: Database, sectionId: number): MovieListRow[] {
  const sql = `
    SELECT movies.id AS id,
      movies.title AS title,
      movies.year AS year,
      MAX(files.duration) AS duration
    FROM metadata_items movies
    INNER JOIN media_items files ON movies.id = files.metadata_item_id
    WHERE movies.metadata_type = 1 AND movies.library_section_id = ?
    GROUP BY movies.id
    ORDER BY movies.title_sort COLLATE NOCASE;
  `;
  const rows = db.prepare(sql).all(sectionId) as {
    id: number;
    title: string;
    year: number | null;
    duration: number | null;
  }[];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    year: r.year == null ? null : Number(r.year),
    duration: r.duration == null ? null : Number(r.duration),
  }));
}

export function fetchShowsForLibrary(db: Database, sectionId: number): ShowListRow[] {
  const sql = `
    SELECT
      shows.id,
      shows.title,
      COUNT(shows.id) AS season_count,
      SUM(seasons.episode_count) AS episode_count
    FROM metadata_items shows
    INNER JOIN (
      SELECT seasons.id, seasons.parent_id AS show_id, COUNT(episodes.id) AS episode_count
      FROM metadata_items seasons
      INNER JOIN metadata_items episodes ON episodes.parent_id = seasons.id
      WHERE seasons.library_section_id = ? AND seasons.metadata_type = 3
      GROUP BY seasons.id
    ) seasons ON shows.id = seasons.show_id
    WHERE shows.metadata_type = 2 AND shows.library_section_id = ?
    GROUP BY shows.id
    ORDER BY shows.title_sort COLLATE NOCASE;
  `;
  const rows = db.prepare(sql).all(sectionId, sectionId) as {
    id: number;
    title: string;
    season_count: number;
    episode_count: number | null;
  }[];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    season_count: Number(r.season_count ?? 0),
    episode_count: Number(r.episode_count ?? 0),
  }));
}

export function fetchSeasonsForShow(db: Database, showMetadataId: number): SeasonListRow[] {
  const sql = `
    SELECT
      seasons.id,
      seasons.title,
      seasons."index" AS season_index,
      COUNT(episodes.id) AS episode_count
    FROM metadata_items seasons
    INNER JOIN metadata_items episodes ON episodes.parent_id = seasons.id
    WHERE seasons.parent_id = ? AND seasons.metadata_type = 3
    GROUP BY seasons.id
    ORDER BY seasons."index" ASC;
  `;
  const rows = db.prepare(sql).all(showMetadataId) as {
    id: number;
    title: string;
    season_index: number;
    episode_count: number;
  }[];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    index: Number(r.season_index),
    episode_count: Number(r.episode_count ?? 0),
  }));
}

export function fetchEpisodesForSeason(db: Database, seasonMetadataId: number): EpisodeListRow[] {
  const sql = `
    SELECT
      e.title AS title,
      e."index" AS ep_index,
      e.id AS id,
      p.title AS season,
      p."index" AS season_index,
      g.title AS show,
      MAX(m.duration) AS duration
    FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id = p.id
    INNER JOIN metadata_items g ON p.parent_id = g.id
    INNER JOIN media_items m ON e.id = m.metadata_item_id
    WHERE p.id = ? AND e.metadata_type = 4
    GROUP BY e.id
    ORDER BY e."index" ASC;
  `;
  const rows = db.prepare(sql).all(seasonMetadataId) as {
    title: string;
    ep_index: number;
    id: number;
    season: string;
    season_index: number;
    show: string;
    duration: number | null;
  }[];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    index: Number(r.ep_index),
    season: String(r.season ?? ''),
    season_index: Number(r.season_index),
    show: String(r.show ?? ''),
    duration: Number(r.duration ?? 0),
  }));
}

export function fetchIntroCreditsMarkersForItem(
  db: Database,
  markerTagId: number,
  metadataItemId: number,
): MarkerRow[] {
  const sql = `
    SELECT
      t.id,
      t.metadata_item_id,
      t."index" AS marker_index,
      t.text AS marker_type,
      t.time_offset AS start_ms,
      t.end_time_offset AS end_ms,
      t.extra_data,
      mi.metadata_type,
      mi.title AS item_title,
      ls.name AS library_name,
      season_meta.title AS season_title,
      show_meta.title AS show_title
    FROM taggings t
    INNER JOIN metadata_items mi ON t.metadata_item_id = mi.id
    INNER JOIN library_sections ls ON mi.library_section_id = ls.id
    LEFT JOIN metadata_items season_meta ON mi.metadata_type = 4 AND mi.parent_id = season_meta.id
    LEFT JOIN metadata_items show_meta ON mi.metadata_type = 4 AND season_meta.parent_id = show_meta.id
    WHERE t.tag_id = ?
      AND t.text IN ('intro', 'credits')
      AND mi.id = ?
    ORDER BY t.time_offset ASC;
  `;
  const rows = db.prepare(sql).all(markerTagId, metadataItemId) as Record<string, unknown>[];
  const out: MarkerRow[] = [];
  for (const r of rows) {
    const markerText = String(r.marker_type ?? '');
    if (markerText !== 'intro' && markerText !== 'credits') {
      continue;
    }
    out.push({
      id: Number(r.id),
      metadata_item_id: Number(r.metadata_item_id),
      index: Number(r.marker_index),
      marker_type: markerText as MarkerKind,
      start_ms: Number(r.start_ms),
      end_ms: Number(r.end_ms),
      extra_data: r.extra_data == null ? null : String(r.extra_data),
      metadata_type: Number(r.metadata_type),
      item_title: String(r.item_title ?? ''),
      library_name: String(r.library_name ?? ''),
      season_title: r.season_title == null ? null : String(r.season_title),
      show_title: r.show_title == null ? null : String(r.show_title),
    });
  }
  return out;
}

export function updateMarker(
  db: Database,
  row: Pick<MarkerRow, 'id' | 'index' | 'marker_type' | 'start_ms' | 'end_ms'>,
  creditsFinal: boolean,
  isLegacyExtraData: boolean,
): void {
  const extra = buildExtraData(row.marker_type, creditsFinal, isLegacyExtraData);
  db.prepare(
    `UPDATE taggings SET "index" = ?, text = ?, time_offset = ?, end_time_offset = ?, extra_data = ? WHERE id = ?;`,
  ).run(row.index, row.marker_type, row.start_ms, row.end_ms, extra, row.id);
}

export function deleteMarker(db: Database, markerId: number): void {
  db.prepare('DELETE FROM taggings WHERE id = ?;').run(markerId);
}

export function swapMarkerOrder(db: Database, markerIdA: number, markerIdB: number): void {
  const ia = runFirstCell(db, 'SELECT "index" FROM taggings WHERE id = ?;', [markerIdA]);
  const ib = runFirstCell(db, 'SELECT "index" FROM taggings WHERE id = ?;', [markerIdB]);
  if (ia === undefined || ia === null || ib === undefined || ib === null) {
    throw new Error('Could not load marker rows to reorder.');
  }
  const na = Number(ia);
  const nb = Number(ib);
  db.prepare('UPDATE taggings SET "index" = ? WHERE id = ?;').run(nb, markerIdA);
  db.prepare('UPDATE taggings SET "index" = ? WHERE id = ?;').run(na, markerIdB);
}

export function getNextMarkerIndex(db: Database, metadataItemId: number, markerTagId: number): number {
  const m = runFirstCell(db, 'SELECT COALESCE(MAX("index"), -1) AS m FROM taggings WHERE metadata_item_id = ? AND tag_id = ?;', [
    metadataItemId,
    markerTagId,
  ]);
  const n = m == null ? -1 : Number(m);
  return Number.isFinite(n) ? n + 1 : 0;
}

export function insertMarker(
  db: Database,
  markerTagId: number,
  metadataItemId: number,
  markerType: MarkerKind,
  startMs: number,
  endMs: number,
  creditsFinal: boolean,
  isLegacyExtraData: boolean,
): void {
  const idx = getNextMarkerIndex(db, metadataItemId, markerTagId);
  const extra = buildExtraData(markerType, creditsFinal, isLegacyExtraData);
  db.prepare(
    `INSERT INTO taggings (metadata_item_id, tag_id, "index", text, time_offset, end_time_offset, thumb_url, created_at, extra_data)
     VALUES (?, ?, ?, ?, ?, ?, '', (strftime('%s','now')), ?);`,
  ).run(metadataItemId, markerTagId, idx, markerType, startMs, endMs, extra);
}
