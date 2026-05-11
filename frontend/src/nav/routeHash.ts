import type {
  EpisodeListRow,
  LibraryRow,
  MovieListRow,
  SeasonListRow,
  ShowListRow,
} from '../lib/plexMarkers';

export type RouteSnapshot = {
  library: LibraryRow | null;
  movie: MovieListRow | null;
  show: ShowListRow | null;
  season: SeasonListRow | null;
  episode: EpisodeListRow | null;
};

export function normalizeHash(hash: string): string {
  const h = hash.trim();
  if (!h || h === '#') {
    return '/';
  }
  const withoutHash = h.startsWith('#') ? h.slice(1) : h;
  const path = withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
  return path || '/';
}

export function serializeRoute(
  library: LibraryRow | null,
  movie: MovieListRow | null,
  show: ShowListRow | null,
  season: SeasonListRow | null,
  episode: EpisodeListRow | null,
): string {
  if (!library) {
    return '/';
  }
  const base = `/library/${library.id}`;
  if (library.type === 1) {
    if (!movie) {
      return base;
    }
    return `${base}/movie/${movie.id}`;
  }
  if (!show) {
    return base;
  }
  const sb = `${base}/show/${show.id}`;
  if (!season) {
    return sb;
  }
  const ss = `${sb}/season/${season.id}`;
  if (!episode) {
    return ss;
  }
  return `${ss}/episode/${episode.id}`;
}
