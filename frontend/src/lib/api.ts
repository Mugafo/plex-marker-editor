import type { RouteSnapshot } from '../nav/routeHash';
import type {
  EpisodeListRow,
  LibraryRow,
  MarkerKind,
  MarkerRow,
  MovieListRow,
  SeasonListRow,
  ShowListRow,
} from './plexMarkers';

const API = '/api';

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string; detail?: string };
    return j.error ?? j.detail ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

export type HealthResponse = {
  ok?: boolean;
  service?: string;
  database: {
    path: string;
    connected: boolean;
    writable: boolean;
    isLegacyExtraData: boolean;
    error: string | null;
    /** True when PLEX_DB_PATH was set but that file is missing */
    fileMissing?: boolean;
  };
};

export async function fetchHealth(): Promise<HealthResponse> {
  const r = await fetch(`${API}/health`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<HealthResponse>;
}

export async function fetchRouteResolve(routePath: string): Promise<RouteSnapshot> {
  const q = new URLSearchParams({ path: routePath });
  const r = await fetch(`${API}/route-resolve?${q}`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<RouteSnapshot>;
}

export async function fetchLibraries(): Promise<LibraryRow[]> {
  const r = await fetch(`${API}/libraries`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<LibraryRow[]>;
}

export async function fetchMoviesForLibrary(sectionId: number): Promise<MovieListRow[]> {
  const r = await fetch(`${API}/libraries/${sectionId}/movies`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<MovieListRow[]>;
}

export async function fetchShowsForLibrary(sectionId: number): Promise<ShowListRow[]> {
  const r = await fetch(`${API}/libraries/${sectionId}/shows`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<ShowListRow[]>;
}

export async function fetchSeasonsForShow(showId: number): Promise<SeasonListRow[]> {
  const r = await fetch(`${API}/shows/${showId}/seasons`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<SeasonListRow[]>;
}

export async function fetchEpisodesForSeason(seasonId: number): Promise<EpisodeListRow[]> {
  const r = await fetch(`${API}/seasons/${seasonId}/episodes`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<EpisodeListRow[]>;
}

export async function fetchMarkersForItem(metadataItemId: number): Promise<MarkerRow[]> {
  const r = await fetch(`${API}/items/${metadataItemId}/markers`);
  if (!r.ok) {
    throw new Error(await readError(r));
  }
  return r.json() as Promise<MarkerRow[]>;
}

export async function patchMarker(body: {
  id: number;
  index: number;
  marker_type: MarkerKind;
  start_ms: number;
  end_ms: number;
  credits_final: boolean;
}): Promise<void> {
  const r = await fetch(`${API}/markers/${body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      index: body.index,
      marker_type: body.marker_type,
      start_ms: body.start_ms,
      end_ms: body.end_ms,
      credits_final: body.credits_final,
    }),
  });
  if (!r.ok) {
    throw new Error(await readError(r));
  }
}

export async function deleteMarker(markerId: number): Promise<void> {
  const r = await fetch(`${API}/markers/${markerId}`, { method: 'DELETE' });
  if (!r.ok) {
    throw new Error(await readError(r));
  }
}

export async function swapMarkers(idA: number, idB: number): Promise<void> {
  const r = await fetch(`${API}/markers/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_a: idA, id_b: idB }),
  });
  if (!r.ok) {
    throw new Error(await readError(r));
  }
}

export async function insertMarker(
  metadataItemId: number,
  markerType: MarkerKind,
  startMs: number,
  endMs: number,
  creditsFinal: boolean,
): Promise<void> {
  const r = await fetch(`${API}/items/${metadataItemId}/markers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      marker_type: markerType,
      start_ms: startMs,
      end_ms: endMs,
      credits_final: creditsFinal,
    }),
  });
  if (!r.ok) {
    throw new Error(await readError(r));
  }
}

