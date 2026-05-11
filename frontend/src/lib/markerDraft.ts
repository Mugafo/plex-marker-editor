import {
  deleteMarker,
  fetchMarkersForItem,
  insertMarker,
  patchMarker,
  type MarkerKind,
} from './api';
import {
  type MarkerRow,
  parseCreditsFinal,
} from './plexMarkers';

export function cloneMarkers(rows: MarkerRow[]): MarkerRow[] {
  return rows.map((r) => ({ ...r }));
}

let tempSeq = 0;
export function allocTempMarkerId(): number {
  tempSeq -= 1;
  return tempSeq;
}

export function sortMarkersForSection(rows: MarkerRow[]): MarkerRow[] {
  return [...rows].sort((a, b) => a.index - b.index || a.start_ms - b.start_ms);
}

function orderSignature(rows: MarkerRow[]): string {
  const intro = sortMarkersForSection(rows.filter((r) => r.marker_type === 'intro'))
    .map((r) => r.id)
    .join(',');
  const cred = sortMarkersForSection(rows.filter((r) => r.marker_type === 'credits'))
    .map((r) => r.id)
    .join(',');
  return `${intro}|${cred}`;
}

function stableSnapshot(rows: MarkerRow[]): string {
  const sorted = rows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      index: r.index,
      marker_type: r.marker_type,
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      extra_data: r.extra_data,
    }));
  return JSON.stringify(sorted);
}

export function markersDirty(baseline: MarkerRow[], draft: MarkerRow[]): boolean {
  return stableSnapshot(baseline) !== stableSnapshot(draft) || orderSignature(baseline) !== orderSignature(draft);
}

function rowNeedsPatch(before: MarkerRow, after: MarkerRow): boolean {
  return (
    before.index !== after.index ||
    before.start_ms !== after.start_ms ||
    before.end_ms !== after.end_ms ||
    before.marker_type !== after.marker_type ||
    (before.extra_data ?? '') !== (after.extra_data ?? '')
  );
}

export function swapDraftIndices(draft: MarkerRow[], idA: number, idB: number): MarkerRow[] {
  const ia = draft.findIndex((r) => r.id === idA);
  const ib = draft.findIndex((r) => r.id === idB);
  if (ia < 0 || ib < 0) {
    return draft;
  }
  const next = draft.slice();
  const a = next[ia]!;
  const b = next[ib]!;
  next[ia] = { ...a, index: b.index };
  next[ib] = { ...b, index: a.index };
  return next;
}

/**
 * Apply deletes, updates, inserts, then return fresh markers from the server.
 */
export async function persistMarkerDraft(
  baseline: MarkerRow[],
  draft: MarkerRow[],
  metadataItemId: number,
): Promise<MarkerRow[]> {
  const draftPositiveIds = new Set(draft.filter((r) => r.id > 0).map((r) => r.id));

  for (const row of baseline) {
    if (!draftPositiveIds.has(row.id)) {
      await deleteMarker(row.id);
    }
  }

  const baseMap = new Map(baseline.map((r) => [r.id, r]));

  for (const row of draft.filter((r) => r.id > 0)) {
    const b = baseMap.get(row.id);
    if (b && rowNeedsPatch(b, row)) {
      await patchMarker({
        id: row.id,
        index: row.index,
        marker_type: row.marker_type,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        credits_final: row.marker_type === 'credits' ? parseCreditsFinal(row.extra_data) : false,
      });
    }
  }

  for (const row of draft.filter((r) => r.id < 0)) {
    await insertMarker(
      metadataItemId,
      row.marker_type,
      row.start_ms,
      row.end_ms,
      row.marker_type === 'credits' ? parseCreditsFinal(row.extra_data) : false,
    );
  }

  return fetchMarkersForItem(metadataItemId);
}
