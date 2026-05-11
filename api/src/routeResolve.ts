import type Database from 'better-sqlite3';
import {
  fetchEpisodesForSeason,
  fetchLibraries,
  fetchMoviesForLibrary,
  fetchSeasonsForShow,
  fetchShowsForLibrary,
  type EpisodeListRow,
  type LibraryRow,
  type MovieListRow,
  type SeasonListRow,
  type ShowListRow,
} from './plexQueries.js';

export type RouteSnapshot = {
  library: LibraryRow | null;
  movie: MovieListRow | null;
  show: ShowListRow | null;
  season: SeasonListRow | null;
  episode: EpisodeListRow | null;
};

function emptySnapshot(): RouteSnapshot {
  return {
    library: null,
    movie: null,
    show: null,
    season: null,
    episode: null,
  };
}

/** Normalize hash-style path to `/library/...` form */
export function normalizeRoutePath(raw: string): string {
  const h = raw.trim();
  if (!h || h === '#') {
    return '/';
  }
  const withoutHash = h.startsWith('#') ? h.slice(1) : h;
  const path = withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
  return path || '/';
}

export function resolveRouteFromDb(db: Database, rawPath: string): RouteSnapshot {
  const path = normalizeRoutePath(rawPath);
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return emptySnapshot();
  }

  if (segments[0] !== 'library' || segments.length < 2) {
    return emptySnapshot();
  }

  const libraryId = Number(segments[1]);
  if (!Number.isFinite(libraryId)) {
    return emptySnapshot();
  }

  const libs = fetchLibraries(db);
  const library = libs.find((l) => l.id === libraryId) ?? null;
  if (!library) {
    return emptySnapshot();
  }

  if (segments.length === 2) {
    return { ...emptySnapshot(), library };
  }

  if (library.type === 1) {
    if (segments[2] === 'movie' && segments[3]) {
      const movieId = Number(segments[3]);
      const movies = fetchMoviesForLibrary(db, libraryId);
      const movie = movies.find((m) => m.id === movieId) ?? null;
      return { ...emptySnapshot(), library, movie };
    }
    return { ...emptySnapshot(), library };
  }

  if (library.type === 2) {
    if (segments[2] !== 'show' || !segments[3]) {
      return { ...emptySnapshot(), library };
    }
    const showId = Number(segments[3]);
    const shows = fetchShowsForLibrary(db, libraryId);
    const show = shows.find((s) => s.id === showId) ?? null;
    if (!show) {
      return { ...emptySnapshot(), library };
    }
    if (segments.length === 4) {
      return { ...emptySnapshot(), library, show };
    }
    if (segments[4] !== 'season' || !segments[5]) {
      return { ...emptySnapshot(), library, show };
    }
    const seasonId = Number(segments[5]);
    const seasons = fetchSeasonsForShow(db, show.id);
    const season = seasons.find((s) => s.id === seasonId) ?? null;
    if (!season) {
      return { ...emptySnapshot(), library, show };
    }
    if (segments.length === 6) {
      return { ...emptySnapshot(), library, show, season };
    }
    if (segments[6] !== 'episode' || !segments[7]) {
      return { ...emptySnapshot(), library, show, season };
    }
    const episodeId = Number(segments[7]);
    const episodes = fetchEpisodesForSeason(db, season.id);
    const episode = episodes.find((e) => e.id === episodeId) ?? null;
    return { ...emptySnapshot(), library, show, season, episode };
  }

  return { ...emptySnapshot(), library };
}
