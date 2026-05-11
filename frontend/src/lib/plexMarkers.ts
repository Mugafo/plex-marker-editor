export type MarkerKind = 'intro' | 'credits';

export type MarkerRow = {
  id: number;
  metadata_item_id: number;
  index: number;
  marker_type: MarkerKind;
  start_ms: number;
  end_ms: number;
  extra_data: string | null;
  /** Plex metadata_type: 1 = movie, 4 = episode */
  metadata_type: number;
  item_title: string;
  library_name: string;
  season_title: string | null;
  show_title: string | null;
};

/** Plex `library_sections.section_type`: 1 = movies, 2 = TV */
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

export function parseCreditsFinal(extra_data: string | null | undefined): boolean {
  return typeof extra_data === 'string' && extra_data.includes('final=1');
}

/** Same encoding as the API for credits “final” / legacy extras (draft edits before Save). */
export function buildExtraData(markerType: MarkerKind, final: boolean, isLegacy: boolean): string | null {
  if (markerType === 'intro') {
    return isLegacy ? 'pv%3Aversion=5' : '{"pv:version":"5","url":"pv%3Aversion=5"}';
  }
  if (final) {
    return isLegacy
      ? 'pv%3Afinal=1&pv%3Aversion=4'
      : '{"pv:final":"1","pv:version":"4","url":"pv%3Afinal=1&pv%3Aversion=4"}';
  }
  return isLegacy ? 'pv%3Aversion=4' : '{"pv:version":"4","url":"pv%3Aversion=4"}';
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frac = ms % 1000;
  const pad = (n: number, d: number) => n.toString().padStart(d, '0');
  if (h > 0) {
    return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 3)}`;
  }
  return `${m}:${pad(s, 2)}.${pad(frac, 3)}`;
}

export function parseTimeToMs(input: string): number | null {
  const t = input.trim();
  if (!t) {
    return null;
  }
  const num = Number(t);
  if (Number.isFinite(num) && num >= 0 && !t.includes(':')) {
    return Math.round(num);
  }
  const parts = t.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '')) {
    return null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const secParts = parts[1].split('.');
    const s = Number(secParts[0]);
    const frac = secParts[1] ? Number(secParts[1].padEnd(3, '0').slice(0, 3)) : 0;
    if ([m, s, frac].every((x) => Number.isFinite(x)) && m >= 0 && s >= 0 && s < 60) {
      return Math.round((m * 60 + s) * 1000 + frac);
    }
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const secParts = parts[2].split('.');
    const s = Number(secParts[0]);
    const frac = secParts[1] ? Number(secParts[1].padEnd(3, '0').slice(0, 3)) : 0;
    if ([h, m, s, frac].every((x) => Number.isFinite(x)) && h >= 0 && m >= 0 && m < 60 && s >= 0 && s < 60) {
      return Math.round(((h * 60 + m) * 60 + s) * 1000 + frac);
    }
  }
  return null;
}
