import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  fetchEpisodesForSeason,
  fetchHealth,
  fetchLibraries,
  fetchMarkersForItem,
  fetchMoviesForLibrary,
  fetchRouteResolve,
  fetchSeasonsForShow,
  fetchShowsForLibrary,
  type HealthResponse,
} from './lib/api';
import {
  allocTempMarkerId,
  cloneMarkers,
  markersDirty,
  persistMarkerDraft,
  sortMarkersForSection,
  swapDraftIndices,
} from './lib/markerDraft';
import {
  buildExtraData,
  formatMs,
  type EpisodeListRow,
  type LibraryRow,
  type MarkerRow,
  type MovieListRow,
  type SeasonListRow,
  type ShowListRow,
  parseCreditsFinal,
  parseTimeToMs,
} from './lib/plexMarkers';
import { normalizeHash, serializeRoute } from './nav/routeHash';
import { ThemeProvider } from './theme/ThemeContext';
import { ThemeSelect } from './theme/ThemeSelect';

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function markerStartVsPeerError(startMs: number, endMs: number, runtimeMs: number | null): string | null {
  if (!Number.isFinite(startMs) || startMs < 0) {
    return 'Must be zero or greater';
  }
  if (!Number.isFinite(endMs)) {
    return null;
  }
  if (startMs >= endMs) {
    return 'Must be before end';
  }
  if (runtimeMs != null && runtimeMs > 0 && startMs > runtimeMs) {
    return `Cannot be past playback end (${formatDurationMs(runtimeMs)})`;
  }
  return null;
}

function markerEndVsPeerError(startMs: number, endMs: number, runtimeMs: number | null): string | null {
  if (!Number.isFinite(endMs) || endMs < 0) {
    return 'Must be zero or greater';
  }
  if (!Number.isFinite(startMs)) {
    return null;
  }
  if (endMs <= startMs) {
    return 'Must be after start';
  }
  if (runtimeMs != null && runtimeMs > 0 && endMs > runtimeMs) {
    return `Cannot be past playback end (${formatDurationMs(runtimeMs)})`;
  }
  return null;
}

function markerRowEditableUnresolved(startStr: string, endStr: string, runtimeMs: number | null): boolean {
  const ps = parseTimeToMs(startStr);
  const pe = parseTimeToMs(endStr);
  if (ps === null || pe === null) {
    return true;
  }
  return (
    markerStartVsPeerError(ps, pe, runtimeMs) !== null || markerEndVsPeerError(ps, pe, runtimeMs) !== null
  );
}

function computeMarkerTimeFieldErrors(
  row: MarkerRow,
  startStr: string,
  endStr: string,
  runtimeMs: number | null,
): { startErr: string | null; endErr: string | null } {
  const ps = parseTimeToMs(startStr);
  const pe = parseTimeToMs(endStr);
  let startErr: string | null = null;
  let endErr: string | null = null;
  if (startStr.trim() && ps === null) {
    startErr = 'Invalid time';
  }
  if (endStr.trim() && pe === null) {
    endErr = 'Invalid time';
  }
  const endForStart = pe !== null ? pe : row.end_ms;
  const startForEnd = ps !== null ? ps : row.start_ms;
  if (ps !== null) {
    startErr = markerStartVsPeerError(ps, endForStart, runtimeMs);
  }
  if (pe !== null) {
    endErr = markerEndVsPeerError(startForEnd, pe, runtimeMs);
  }
  return { startErr, endErr };
}

/** Default Plex-style intro span (90s); clamped against runtime when known. */
const INTRO_DEFAULT_SPAN_MS = 90_000;

/** If multiple credits rows carry Plex “final”, keep the first by row order and clear the rest. */
function enforceSingleCreditsFinal(rows: MarkerRow[], isLegacy: boolean): MarkerRow[] {
  let finalKept = false;
  return rows.map((r) => {
    if (r.marker_type !== 'credits') {
      return r;
    }
    const wantsFinal = parseCreditsFinal(r.extra_data);
    if (!wantsFinal) {
      return r;
    }
    if (!finalKept) {
      finalKept = true;
      return { ...r, extra_data: buildExtraData('credits', true, isLegacy) };
    }
    return { ...r, extra_data: buildExtraData('credits', false, isLegacy) };
  });
}

function IntroMarkerRow({
  row,
  runtimeMs,
  onUpdateRow,
  onDeleteRow,
  onRowTimeStateChange,
  disabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  row: MarkerRow;
  runtimeMs: number | null;
  onUpdateRow: (id: number, patch: Partial<MarkerRow>) => void;
  onDeleteRow: (id: number) => void;
  onRowTimeStateChange: (rowId: number, unresolved: boolean) => void;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [startStr, setStartStr] = useState(formatMs(row.start_ms));
  const [endStr, setEndStr] = useState(formatMs(row.end_ms));
  const [startErr, setStartErr] = useState<string | null>(null);
  const [endErr, setEndErr] = useState<string | null>(null);

  useEffect(() => {
    setStartStr(formatMs(row.start_ms));
    setEndStr(formatMs(row.end_ms));
  }, [row.id, row.start_ms, row.end_ms]);

  useEffect(() => {
    const { startErr: s, endErr: e } = computeMarkerTimeFieldErrors(row, startStr, endStr, runtimeMs);
    setStartErr(s);
    setEndErr(e);
    onRowTimeStateChange(row.id, markerRowEditableUnresolved(startStr, endStr, runtimeMs));
  }, [row.id, row.start_ms, row.end_ms, startStr, endStr, runtimeMs, onRowTimeStateChange]);

  const tryPatchStart = (nextStartStr: string, nextEndStr: string) => {
    const ps = parseTimeToMs(nextStartStr);
    const pe = parseTimeToMs(nextEndStr);
    const peerEnd = pe !== null ? pe : row.end_ms;
    if (ps !== null && markerStartVsPeerError(ps, peerEnd, runtimeMs) === null) {
      onUpdateRow(row.id, { start_ms: ps });
    }
  };

  const tryPatchEnd = (nextStartStr: string, nextEndStr: string) => {
    const ps = parseTimeToMs(nextStartStr);
    const pe = parseTimeToMs(nextEndStr);
    const peerStart = ps !== null ? ps : row.start_ms;
    if (pe !== null && markerEndVsPeerError(peerStart, pe, runtimeMs) === null) {
      onUpdateRow(row.id, { end_ms: pe });
    }
  };

  return (
    <Fragment>
      <tr>
        <td className="marker-table__order">
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={disabled || !canMoveUp}
            onClick={onMoveUp}
            aria-label="Move intro up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={disabled || !canMoveDown}
            onClick={onMoveDown}
            aria-label="Move intro down"
          >
            ↓
          </button>
        </td>
        <td>
          <input
            type="text"
            value={startStr}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setStartStr(v);
              tryPatchStart(v, endStr);
            }}
            aria-label="Start time"
            aria-invalid={startErr ? true : undefined}
          />
        </td>
        <td>
          <input
            type="text"
            value={endStr}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setEndStr(v);
              tryPatchEnd(startStr, v);
            }}
            aria-label="End time"
            aria-invalid={endErr ? true : undefined}
          />
        </td>
        <td className="marker-table__col-final-slot" aria-hidden />
        <td>
          <button
            type="button"
            className="btn btn--danger"
            disabled={disabled}
            onClick={() => {
              if (window.confirm('Delete this intro marker?')) {
                onDeleteRow(row.id);
              }
            }}
          >
            Delete
          </button>
        </td>
      </tr>
    </Fragment>
  );
}

function CreditsMarkerRow({
  row,
  runtimeMs,
  onUpdateRow,
  onSetCreditsFinal,
  onDeleteRow,
  onRowTimeStateChange,
  disabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  row: MarkerRow;
  runtimeMs: number | null;
  onUpdateRow: (id: number, patch: Partial<MarkerRow>) => void;
  onSetCreditsFinal: (id: number, final: boolean) => void;
  onDeleteRow: (id: number) => void;
  onRowTimeStateChange: (rowId: number, unresolved: boolean) => void;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const finalInit = parseCreditsFinal(row.extra_data);
  const [startStr, setStartStr] = useState(formatMs(row.start_ms));
  const [endStr, setEndStr] = useState(formatMs(row.end_ms));
  const [creditsFinal, setCreditsFinal] = useState(finalInit);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [endErr, setEndErr] = useState<string | null>(null);

  useEffect(() => {
    setStartStr(formatMs(row.start_ms));
    setEndStr(formatMs(row.end_ms));
    setCreditsFinal(parseCreditsFinal(row.extra_data));
  }, [row.id, row.start_ms, row.end_ms, row.extra_data]);

  useEffect(() => {
    const { startErr: s, endErr: e } = computeMarkerTimeFieldErrors(row, startStr, endStr, runtimeMs);
    setStartErr(s);
    setEndErr(e);
    onRowTimeStateChange(row.id, markerRowEditableUnresolved(startStr, endStr, runtimeMs));
  }, [row.id, row.start_ms, row.end_ms, row.extra_data, startStr, endStr, runtimeMs, onRowTimeStateChange]);

  const tryPatchStart = (nextStartStr: string, nextEndStr: string) => {
    const ps = parseTimeToMs(nextStartStr);
    const pe = parseTimeToMs(nextEndStr);
    const peerEnd = pe !== null ? pe : row.end_ms;
    if (ps !== null && markerStartVsPeerError(ps, peerEnd, runtimeMs) === null) {
      onUpdateRow(row.id, { start_ms: ps });
    }
  };

  const tryPatchEnd = (nextStartStr: string, nextEndStr: string) => {
    const ps = parseTimeToMs(nextStartStr);
    const pe = parseTimeToMs(nextEndStr);
    const peerStart = ps !== null ? ps : row.start_ms;
    if (pe !== null && markerEndVsPeerError(peerStart, pe, runtimeMs) === null) {
      onUpdateRow(row.id, { end_ms: pe });
    }
  };

  return (
    <Fragment>
      <tr>
        <td className="marker-table__order">
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={disabled || !canMoveUp}
            onClick={onMoveUp}
            aria-label="Move credits block up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={disabled || !canMoveDown}
            onClick={onMoveDown}
            aria-label="Move credits block down"
          >
            ↓
          </button>
        </td>
        <td>
          <input
            type="text"
            value={startStr}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setStartStr(v);
              tryPatchStart(v, endStr);
            }}
            aria-label="Start time"
            aria-invalid={startErr ? true : undefined}
          />
        </td>
        <td>
          <input
            type="text"
            value={endStr}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setEndStr(v);
              tryPatchEnd(startStr, v);
            }}
            aria-label="End time"
            aria-invalid={endErr ? true : undefined}
          />
        </td>
        <td className="marker-table__col-final-slot" style={{ textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={creditsFinal}
            disabled={disabled}
            onChange={(e) => {
              const checked = e.target.checked;
              setCreditsFinal(checked);
              onSetCreditsFinal(row.id, checked);
            }}
            aria-label="Final credits segment (extends to end of media)"
            title="Plex uses this to extend this credits segment to the end of the file"
          />
        </td>
        <td>
          <button
            type="button"
            className="btn btn--danger"
            disabled={disabled}
            onClick={() => {
              if (window.confirm('Delete this credits marker?')) {
                onDeleteRow(row.id);
              }
            }}
          >
            Delete
          </button>
        </td>
      </tr>
    </Fragment>
  );
}

const BOOT_SPLASH_PHASE_MS = 1500;
/** Brief “loading” on step 1 before showing DB-unavailable failure (fail-fast path). */
const BOOT_SPLASH_DB_FAIL_LOAD_MS = 450;

const BOOT_SPLASH_CHECKLIST_ITEMS = [
  'Loading database…',
  'Checking Write Access…',
  'Scanning libraries…',
] as const;

function AppShell() {
  const applyingUrlRef = useRef(false);
  const dbConnectedRef = useRef(false);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthPending, setHealthPending] = useState(true);
  const [minBootSplashDone, setMinBootSplashDone] = useState(false);
  const [bootChecklistCompleted, setBootChecklistCompleted] = useState(0);
  const [bootSplashDbLoadFailed, setBootSplashDbLoadFailed] = useState(false);

  const [libraries, setLibraries] = useState<LibraryRow[]>([]);
  const [movies, setMovies] = useState<MovieListRow[]>([]);
  const [shows, setShows] = useState<ShowListRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonListRow[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeListRow[]>([]);
  const [baselineMarkers, setBaselineMarkers] = useState<MarkerRow[]>([]);
  const [draftMarkers, setDraftMarkers] = useState<MarkerRow[]>([]);
  const [markerSaveError, setMarkerSaveError] = useState<string | null>(null);
  const [markerSaving, setMarkerSaving] = useState(false);
  const [markerTimesUnresolved, setMarkerTimesUnresolved] = useState(false);
  const [markerTableRemountSeq, setMarkerTableRemountSeq] = useState(0);

  const [listFilter, setListFilter] = useState('');
  const [navError, setNavError] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryRow | null>(null);
  const [movie, setMovie] = useState<MovieListRow | null>(null);
  const [show, setShow] = useState<ShowListRow | null>(null);
  const [season, setSeason] = useState<SeasonListRow | null>(null);
  const [episode, setEpisode] = useState<EpisodeListRow | null>(null);

  const dbConnected = Boolean(health?.database.connected);

  useEffect(() => {
    dbConnectedRef.current = dbConnected;
  }, [dbConnected]);

  useEffect(() => {
    let cancelled = false;
    setHealthPending(true);
    void fetchHealth()
      .then((h) => {
        if (!cancelled) {
          setHealth(h);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHealthPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof window.setTimeout>[] = [];
    setMinBootSplashDone(false);

    if (healthPending) {
      setBootChecklistCompleted(0);
      setBootSplashDbLoadFailed(false);
      return () => {
        for (const t of timers) {
          window.clearTimeout(t);
        }
      };
    }

    if (!dbConnected) {
      setBootChecklistCompleted(0);
      setBootSplashDbLoadFailed(false);
      timers.push(
        window.setTimeout(() => {
          setBootSplashDbLoadFailed(true);
        }, BOOT_SPLASH_DB_FAIL_LOAD_MS),
      );
      return () => {
        for (const t of timers) {
          window.clearTimeout(t);
        }
      };
    }

    setBootSplashDbLoadFailed(false);
    setBootChecklistCompleted(0);
    timers.push(window.setTimeout(() => setBootChecklistCompleted(1), BOOT_SPLASH_PHASE_MS));
    timers.push(window.setTimeout(() => setBootChecklistCompleted(2), BOOT_SPLASH_PHASE_MS * 2));
    timers.push(
      window.setTimeout(() => {
        setBootChecklistCompleted(3);
      }, BOOT_SPLASH_PHASE_MS * 3),
    );
    timers.push(
      window.setTimeout(() => {
        setMinBootSplashDone(true);
      }, BOOT_SPLASH_PHASE_MS * 4),
    );
    return () => {
      for (const t of timers) {
        window.clearTimeout(t);
      }
    };
  }, [healthPending, dbConnected]);

  /** When DB is reachable: load libraries and restore navigation from the URL hash. */
  useEffect(() => {
    if (!dbConnected) {
      setLibraries([]);
      setLibrary(null);
      setMovie(null);
      setShow(null);
      setSeason(null);
      setEpisode(null);
      setNavError(null);
      return;
    }

    let cancelled = false;
    setNavError(null);

    void (async () => {
      try {
        const [libs, snap] = await Promise.all([
          fetchLibraries(),
          fetchRouteResolve(normalizeHash(window.location.hash)),
        ]);
        if (cancelled) {
          return;
        }
        setLibraries(libs);
        applyingUrlRef.current = true;
        setLibrary(snap.library);
        setMovie(snap.movie);
        setShow(snap.show);
        setSeason(snap.season);
        setEpisode(snap.episode);
        setListFilter('');
        const canon = serializeRoute(snap.library, snap.movie, snap.show, snap.season, snap.episode);
        if (normalizeHash(window.location.hash) !== canon) {
          window.history.replaceState(null, '', `#${canon}`);
        }
        applyingUrlRef.current = false;
      } catch (e) {
        if (!cancelled) {
          setNavError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbConnected]);

  useEffect(() => {
    if (!dbConnected || !library || library.type !== 1) {
      setMovies([]);
      return;
    }
    let cancelled = false;
    void fetchMoviesForLibrary(library.id).then((rows) => {
      if (!cancelled) {
        setMovies(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dbConnected, library]);

  useEffect(() => {
    if (!dbConnected || !library || library.type !== 2) {
      setShows([]);
      return;
    }
    let cancelled = false;
    void fetchShowsForLibrary(library.id).then((rows) => {
      if (!cancelled) {
        setShows(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dbConnected, library]);

  useEffect(() => {
    if (!dbConnected || !show) {
      setSeasons([]);
      return;
    }
    let cancelled = false;
    void fetchSeasonsForShow(show.id).then((rows) => {
      if (!cancelled) {
        setSeasons(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dbConnected, show]);

  useEffect(() => {
    if (!dbConnected || !season) {
      setEpisodes([]);
      return;
    }
    let cancelled = false;
    void fetchEpisodesForSeason(season.id).then((rows) => {
      if (!cancelled) {
        setEpisodes(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dbConnected, season]);

  const metaId =
    library?.type === 1 && movie ? movie.id : library?.type === 2 && episode ? episode.id : null;

  useEffect(() => {
    if (!dbConnected || metaId == null) {
      setBaselineMarkers([]);
      setDraftMarkers([]);
      setMarkerSaveError(null);
      setMarkerTimesUnresolved(false);
      return;
    }
    let cancelled = false;
    const isLegacy = Boolean(health?.database.isLegacyExtraData);
    void fetchMarkersForItem(metaId).then((rows) => {
      if (!cancelled) {
        const normalized = cloneMarkers(enforceSingleCreditsFinal(rows, isLegacy));
        setBaselineMarkers(normalized);
        setDraftMarkers(cloneMarkers(normalized));
        setMarkerSaveError(null);
        setMarkerTimesUnresolved(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dbConnected, metaId, health?.database.isLegacyExtraData]);

  useEffect(() => {
    if (!dbConnected) {
      return;
    }

    if (applyingUrlRef.current) {
      return;
    }
    const target = serializeRoute(library, movie, show, season, episode);
    const current = normalizeHash(window.location.hash);
    if (target === current) {
      return;
    }
    window.history.pushState(null, '', `#${target}`);
  }, [dbConnected, library, movie, show, season, episode]);

  const editorRuntimeMs = useMemo((): number | null => {
    if (library?.type === 1 && movie?.duration != null && Number.isFinite(movie.duration)) {
      return movie.duration;
    }
    if (library?.type === 2 && episode?.duration != null && Number.isFinite(episode.duration)) {
      return episode.duration;
    }
    return null;
  }, [library?.type, movie?.duration, episode?.duration]);

  const onMarkerTimesUnresolvedChange = useCallback((active: boolean) => {
    setMarkerTimesUnresolved((prev) => (prev === active ? prev : active));
  }, []);

  const markersDraftDirty = useMemo(() => markersDirty(baselineMarkers, draftMarkers), [baselineMarkers, draftMarkers]);

  const markersPending = markersDraftDirty || markerTimesUnresolved;

  const markersPendingRef = useRef(markersPending);
  markersPendingRef.current = markersPending;

  /** Latest route for browser back guard (popstate runs outside React commit). */
  const navSnapRef = useRef<{
    library: LibraryRow | null;
    movie: MovieListRow | null;
    show: ShowListRow | null;
    season: SeasonListRow | null;
    episode: EpisodeListRow | null;
  }>({ library: null, movie: null, show: null, season: null, episode: null });
  navSnapRef.current = { library, movie, show, season, episode };

  const leaveMarkersOrConfirm = useCallback(
    (proceed: () => void) => {
      if (!markersPending) {
        proceed();
        return;
      }
      if (window.confirm('You have unsaved marker changes. Leave without saving?')) {
        proceed();
      }
    },
    [markersPending],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!markersPendingRef.current) {
        return;
      }
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (!dbConnectedRef.current) {
        return;
      }
      const { library: lib, movie: mov, show: sho, season: sea, episode: ep } = navSnapRef.current;
      const prevCanon = serializeRoute(lib, mov, sho, sea, ep);
      const nextHash = normalizeHash(window.location.hash);
      if (markersPendingRef.current && nextHash !== prevCanon) {
        if (!window.confirm('You have unsaved marker changes. Leave without saving?')) {
          applyingUrlRef.current = true;
          window.history.pushState(null, '', `#${prevCanon}`);
          applyingUrlRef.current = false;
          return;
        }
      }
      void (async () => {
        try {
          applyingUrlRef.current = true;
          const snap = await fetchRouteResolve(nextHash);
          setLibrary(snap.library);
          setMovie(snap.movie);
          setShow(snap.show);
          setSeason(snap.season);
          setEpisode(snap.episode);
          setListFilter('');
        } catch {
          /* ignore */
        } finally {
          applyingUrlRef.current = false;
        }
      })();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const markerTemplate = useMemo((): Pick<
    MarkerRow,
    'metadata_item_id' | 'metadata_type' | 'item_title' | 'library_name' | 'season_title' | 'show_title'
  > | null => {
    if (metaId == null || !library) {
      return null;
    }
    if (library.type === 1 && movie) {
      return {
        metadata_item_id: metaId,
        metadata_type: 1,
        item_title: movie.title,
        library_name: library.name,
        season_title: null,
        show_title: null,
      };
    }
    if (library.type === 2 && episode && show) {
      return {
        metadata_item_id: metaId,
        metadata_type: 4,
        item_title: episode.title,
        library_name: library.name,
        season_title: season?.title ?? null,
        show_title: show.title,
      };
    }
    return null;
  }, [metaId, library, movie, show, season, episode]);

  const updateDraftRow = useCallback((id: number, patch: Partial<MarkerRow>) => {
    setDraftMarkers((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const setCreditsFinalExclusive = useCallback(
    (id: number, final: boolean) => {
      const isLeg = Boolean(health?.database.isLegacyExtraData);
      setDraftMarkers((prev) =>
        prev.map((r) => {
          if (r.marker_type !== 'credits') {
            return r;
          }
          if (final) {
            return {
              ...r,
              extra_data: buildExtraData('credits', r.id === id, isLeg),
            };
          }
          if (r.id === id) {
            return { ...r, extra_data: buildExtraData('credits', false, isLeg) };
          }
          return r;
        }),
      );
    },
    [health?.database.isLegacyExtraData],
  );

  const removeDraftRow = useCallback((id: number) => {
    setDraftMarkers((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const swapDraftMarkerPair = useCallback((idA: number, idB: number) => {
    setDraftMarkers((prev) => swapDraftIndices(prev, idA, idB));
  }, []);

  const discardMarkerDraft = useCallback(() => {
    setDraftMarkers(cloneMarkers(baselineMarkers));
    setMarkerSaveError(null);
    setMarkerTimesUnresolved(false);
    setMarkerTableRemountSeq((n) => n + 1);
  }, [baselineMarkers]);

  const saveMarkerDraft = useCallback(async () => {
    if (metaId == null || !markerTemplate) {
      return;
    }
    if (markerTimesUnresolved) {
      setMarkerSaveError('Finish editing times (invalid or incomplete fields) before saving.');
      return;
    }
    const runtime = editorRuntimeMs;
    for (const row of draftMarkers) {
      if (row.start_ms < 0 || row.end_ms < 0) {
        setMarkerSaveError('Marker times cannot be negative. Fix invalid rows before saving.');
        return;
      }
      if (row.start_ms >= row.end_ms) {
        setMarkerSaveError('Each marker needs start before end. Fix invalid rows before saving.');
        return;
      }
      if (runtime != null && runtime > 0) {
        if (row.start_ms > runtime || row.end_ms > runtime) {
          setMarkerSaveError(
            `Marker times cannot exceed playback length (${formatDurationMs(runtime)}). Fix invalid rows before saving.`,
          );
          return;
        }
      }
    }
    setMarkerSaving(true);
    setMarkerSaveError(null);
    try {
      const fresh = await persistMarkerDraft(baselineMarkers, draftMarkers, metaId);
      setBaselineMarkers(cloneMarkers(fresh));
      setDraftMarkers(cloneMarkers(fresh));
      setMarkerTimesUnresolved(false);
      setMarkerTableRemountSeq((n) => n + 1);
    } catch (e) {
      setMarkerSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setMarkerSaving(false);
    }
  }, [baselineMarkers, draftMarkers, editorRuntimeMs, markerTemplate, markerTimesUnresolved, metaId]);

  const queueIntroDraft = useCallback(
    (startMs: number, endMs: number) => {
      if (!markerTemplate) {
        return;
      }
      setDraftMarkers((prev) => {
        const nextIndex = Math.max(-1, ...prev.map((r) => r.index)) + 1;
        const row: MarkerRow = {
          ...markerTemplate,
          id: allocTempMarkerId(),
          index: nextIndex,
          marker_type: 'intro',
          start_ms: startMs,
          end_ms: endMs,
          extra_data: null,
        };
        return [...prev, row];
      });
    },
    [markerTemplate],
  );

  const queueCreditsDraft = useCallback(
    (startMs: number, endMs: number, creditsFinal: boolean) => {
      if (!markerTemplate) {
        return;
      }
      const isLeg = Boolean(health?.database.isLegacyExtraData);
      setDraftMarkers((prev) => {
        const base = creditsFinal
          ? prev.map((r) =>
              r.marker_type === 'credits'
                ? { ...r, extra_data: buildExtraData('credits', false, isLeg) }
                : r,
            )
          : prev;
        const nextIndex = Math.max(-1, ...base.map((r) => r.index)) + 1;
        const row: MarkerRow = {
          ...markerTemplate,
          id: allocTempMarkerId(),
          index: nextIndex,
          marker_type: 'credits',
          start_ms: startMs,
          end_ms: endMs,
          extra_data: buildExtraData('credits', creditsFinal, isLeg),
        };
        return [...base, row];
      });
    },
    [markerTemplate, health?.database.isLegacyExtraData],
  );

  const resetNavigation = useCallback(() => {
    leaveMarkersOrConfirm(() => {
      setLibrary(null);
      setMovie(null);
      setShow(null);
      setSeason(null);
      setEpisode(null);
      setListFilter('');
    });
  }, [leaveMarkersOrConfirm]);

  const goToLibraryRoot = useCallback(() => {
    leaveMarkersOrConfirm(() => {
      setMovie(null);
      setShow(null);
      setSeason(null);
      setEpisode(null);
      setListFilter('');
    });
  }, [leaveMarkersOrConfirm]);

  const filteredLibraries = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) {
      return libraries;
    }
    return libraries.filter((l) => l.name.toLowerCase().includes(q));
  }, [libraries, listFilter]);

  const filteredMovies = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) {
      return movies;
    }
    return movies.filter((m) => m.title.toLowerCase().includes(q));
  }, [movies, listFilter]);

  const filteredShows = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) {
      return shows;
    }
    return shows.filter((s) => s.title.toLowerCase().includes(q));
  }, [shows, listFilter]);

  const filteredSeasons = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) {
      return seasons;
    }
    return seasons.filter((s) => (s.title || '').toLowerCase().includes(q) || String(s.index).includes(q));
  }, [seasons, listFilter]);

  const filteredEpisodes = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) {
      return episodes;
    }
    return episodes.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.show.toLowerCase().includes(q) ||
        e.season.toLowerCase().includes(q),
    );
  }, [episodes, listFilter]);

  const pickLibrary = useCallback(
    (lib: LibraryRow) => {
      leaveMarkersOrConfirm(() => {
        setLibrary(lib);
        setMovie(null);
        setShow(null);
        setSeason(null);
        setEpisode(null);
        setListFilter('');
      });
    },
    [leaveMarkersOrConfirm],
  );

  const pickMovie = useCallback(
    (m: MovieListRow) => {
      leaveMarkersOrConfirm(() => {
        setMovie(m);
        setListFilter('');
      });
    },
    [leaveMarkersOrConfirm],
  );

  const pickShow = useCallback(
    (s: ShowListRow) => {
      leaveMarkersOrConfirm(() => {
        setShow(s);
        setSeason(null);
        setEpisode(null);
        setListFilter('');
      });
    },
    [leaveMarkersOrConfirm],
  );

  const pickSeason = useCallback(
    (s: SeasonListRow) => {
      leaveMarkersOrConfirm(() => {
        setSeason(s);
        setEpisode(null);
        setListFilter('');
      });
    },
    [leaveMarkersOrConfirm],
  );

  const pickEpisode = useCallback(
    (e: EpisodeListRow) => {
      leaveMarkersOrConfirm(() => {
        setEpisode(e);
        setListFilter('');
      });
    },
    [leaveMarkersOrConfirm],
  );

  const breadcrumbs = useMemo(() => {
    if (!dbConnected) {
      return [];
    }
    type Crumb = { label: string; navigate?: () => void };
    const out: Crumb[] = [];
    if (!library) {
      out.push({ label: 'Libraries' });
      return out;
    }
    out.push({ label: 'Libraries', navigate: resetNavigation });
    if (library.type === 1 && !movie) {
      out.push({ label: library.name });
      return out;
    }
    if (library.type === 1 && movie) {
      out.push({
        label: library.name,
        navigate: () => {
          leaveMarkersOrConfirm(() => {
            setMovie(null);
            setListFilter('');
          });
        },
      });
      out.push({ label: movie.title });
      return out;
    }
    if (library.type === 2 && !show) {
      out.push({ label: library.name });
      return out;
    }
    if (library.type === 2 && show && !season) {
      out.push({ label: library.name, navigate: goToLibraryRoot });
      out.push({ label: show.title });
      return out;
    }
    if (library.type === 2 && show && season && !episode) {
      const seasonLabel = season.title?.trim() ? season.title : `Season ${season.index}`;
      out.push({ label: library.name, navigate: goToLibraryRoot });
      out.push({
        label: show.title,
        navigate: () => {
          leaveMarkersOrConfirm(() => {
            setSeason(null);
            setEpisode(null);
            setListFilter('');
          });
        },
      });
      out.push({ label: seasonLabel });
      return out;
    }
    if (library.type === 2 && show && season && episode) {
      const seasonLabel = season.title?.trim() ? season.title : `Season ${season.index}`;
      const epLabel =
        episode.title?.trim() ? `${episode.index}. ${episode.title}` : `Episode ${episode.index}`;
      out.push({ label: library.name, navigate: goToLibraryRoot });
      out.push({
        label: show.title,
        navigate: () => {
          leaveMarkersOrConfirm(() => {
            setSeason(null);
            setEpisode(null);
            setListFilter('');
          });
        },
      });
      out.push({
        label: seasonLabel,
        navigate: () => {
          leaveMarkersOrConfirm(() => {
            setEpisode(null);
            setListFilter('');
          });
        },
      });
      out.push({ label: epLabel });
      return out;
    }
    return out;
  }, [dbConnected, library, movie, show, season, episode, resetNavigation, goToLibraryRoot, leaveMarkersOrConfirm]);

  const showMarkerEditor =
    dbConnected &&
    !!library &&
    ((library.type === 1 && !!movie) || (library.type === 2 && !!episode));

  const listSectionTitle = !library
    ? 'Libraries'
    : library.type === 1 && !movie
      ? 'Movies'
      : library.type === 2 && !show
        ? 'TV shows'
        : library.type === 2 && show && !season
          ? 'Seasons'
          : library.type === 2 && season && !episode
            ? 'Episodes'
            : '';

  const showMarkerDock = showMarkerEditor && markersPending;
  const showBootDbSplash = healthPending || !minBootSplashDone;

  return (
    <div className={`app${showMarkerDock ? ' app--marker-dock' : ''}`}>
      <main className="app__main">
        {showBootDbSplash ? (
          <div className="panel db-splash" role="status" aria-live="polite" aria-label="Connecting to Plex database">
            <h2 className="db-splash__title">Connecting to Plex database…</h2>
            <div className="db-splash__path mono">
              Opening <span className="db-splash__path-pill">/data/com.plexapp.plugins.library.db</span>
            </div>
            <ul className="db-splash__checklist" aria-label="Startup checklist">
              {BOOT_SPLASH_CHECKLIST_ITEMS.map((label, i) => {
                const firstFailed = i === 0 && bootSplashDbLoadFailed;
                const done = i < bootChecklistCompleted;
                const active =
                  !firstFailed &&
                  bootChecklistCompleted === i &&
                  bootChecklistCompleted < BOOT_SPLASH_CHECKLIST_ITEMS.length;
                return (
                  <li
                    key={label}
                    className={`db-splash__check-item${done ? ' db-splash__check-item--done' : ''}${
                      firstFailed ? ' db-splash__check-item--failed' : ''
                    }${active ? ' db-splash__check-item--active' : ''}${
                      !done && !active && !firstFailed ? ' db-splash__check-item--pending' : ''
                    }`}
                  >
                    <span className="db-splash__check-icon" aria-hidden>
                      {firstFailed ? (
                        <svg
                          className="db-splash__fail-x"
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden
                        >
                          <path
                            d="M4 4 12 12M12 4 4 12"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : done ? (
                        <svg
                          className="db-splash__check-svg"
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden
                        >
                          <path
                            d="M3.5 8.25 6.5 11.25 12.5 4.75"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <span className="db-splash__check-label">{label}</span>
                  </li>
                );
              })}
            </ul>
            <div className="db-splash__warn">
              <strong>Important:</strong> Make a backup copy of your Plex DB before making changes.
            </div>
          </div>
        ) : null}

        {!showBootDbSplash ? (
          <>
            {!dbConnected ? (
              <div className="breadcrumb panel app__top-strip" aria-label="Theme">
                <div className="breadcrumb__trail" />
                <div className="breadcrumb__toolbar">
                  <ThemeSelect />
                </div>
              </div>
            ) : null}

            {navError ? (
              <div className="panel" style={{ marginBottom: '1rem' }}>
                <p className="panel__error">{navError}</p>
              </div>
            ) : null}

            {dbConnected ? (
              <>
            {breadcrumbs.length > 0 ? (
              <nav className="breadcrumb panel" aria-label="Breadcrumb">
                <div className="breadcrumb__trail">
                  {breadcrumbs.map((crumb, i) => (
                    <Fragment key={`${crumb.label}-${i}`}>
                      {i > 0 ? (
                        <span className="breadcrumb__sep" aria-hidden>
                          /
                        </span>
                      ) : null}
                      {crumb.navigate ? (
                        <a
                          href="#"
                          className="breadcrumb-link"
                          onClick={(e) => {
                            e.preventDefault();
                            crumb.navigate?.();
                          }}
                        >
                          {crumb.label}
                        </a>
                      ) : (
                        <span className="breadcrumb-current">{crumb.label}</span>
                      )}
                    </Fragment>
                  ))}
                </div>
                <div className="breadcrumb__toolbar">
                  <ThemeSelect />
                </div>
              </nav>
            ) : null}

            {!library ? (
              <div className="panel nav-panel">
                <h2 className="nav-panel__title">{listSectionTitle}</h2>
                <div className="toolbar">
                  <div className="field">
                    <label htmlFor="list-filter">Filter</label>
                    <input
                      id="list-filter"
                      type="search"
                      placeholder="Library name…"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                    />
                  </div>
                  <span className="mono meta-count">{filteredLibraries.length} libraries</span>
                </div>
                <ul className="pick-list">
                  {filteredLibraries.map((lib) => (
                    <li key={lib.id}>
                      <button type="button" className="pick-list__row" onClick={() => pickLibrary(lib)}>
                        <span className="pick-list__title">{lib.name}</span>
                        <span className="pick-list__meta mono">{lib.type === 1 ? 'Movies' : 'TV'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredLibraries.length === 0 ? <p className="empty quiet">No libraries match.</p> : null}
              </div>
            ) : null}

            {library && library.type === 1 && !movie ? (
              <div className="panel nav-panel">
                <h2 className="nav-panel__title">{listSectionTitle}</h2>
                <div className="toolbar">
                  <div className="field">
                    <label htmlFor="list-filter-m">Filter</label>
                    <input
                      id="list-filter-m"
                      type="search"
                      placeholder="Movie title…"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                    />
                  </div>
                  <span className="mono meta-count">{filteredMovies.length} movies</span>
                </div>
                <ul className="pick-list">
                  {filteredMovies.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="pick-list__row" onClick={() => pickMovie(m)}>
                        <span className="pick-list__title">{m.title}</span>
                        <span className="pick-list__meta mono">
                          {m.year != null ? `${m.year} · ` : ''}
                          {formatDurationMs(m.duration ?? 0)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredMovies.length === 0 ? <p className="empty quiet">No movies match.</p> : null}
              </div>
            ) : null}

            {library && library.type === 2 && !show ? (
              <div className="panel nav-panel">
                <h2 className="nav-panel__title">{listSectionTitle}</h2>
                <div className="toolbar">
                  <div className="field">
                    <label htmlFor="list-filter-s">Filter</label>
                    <input
                      id="list-filter-s"
                      type="search"
                      placeholder="Show title…"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                    />
                  </div>
                  <span className="mono meta-count">{filteredShows.length} shows</span>
                </div>
                <ul className="pick-list">
                  {filteredShows.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="pick-list__row" onClick={() => pickShow(s)}>
                        <span className="pick-list__title">{s.title}</span>
                        <span className="pick-list__meta mono">
                          {s.season_count} seasons · {s.episode_count} episodes
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredShows.length === 0 ? <p className="empty quiet">No shows match.</p> : null}
              </div>
            ) : null}

            {library && library.type === 2 && show && !season ? (
              <div className="panel nav-panel">
                <h2 className="nav-panel__title">{listSectionTitle}</h2>
                <div className="toolbar">
                  <div className="field">
                    <label htmlFor="list-filter-se">Filter</label>
                    <input
                      id="list-filter-se"
                      type="search"
                      placeholder="Season…"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                    />
                  </div>
                  <span className="mono meta-count">{filteredSeasons.length} seasons</span>
                </div>
                <ul className="pick-list">
                  {filteredSeasons.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="pick-list__row" onClick={() => pickSeason(s)}>
                        <span className="pick-list__title">{s.title?.trim() ? s.title : `Season ${s.index}`}</span>
                        <span className="pick-list__meta mono">{s.episode_count} episodes</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredSeasons.length === 0 ? <p className="empty quiet">No seasons match.</p> : null}
              </div>
            ) : null}

            {library && library.type === 2 && season && !episode ? (
              <div className="panel nav-panel">
                <h2 className="nav-panel__title">{listSectionTitle}</h2>
                <div className="toolbar">
                  <div className="field">
                    <label htmlFor="list-filter-e">Filter</label>
                    <input
                      id="list-filter-e"
                      type="search"
                      placeholder="Episode…"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                    />
                  </div>
                  <span className="mono meta-count">{filteredEpisodes.length} episodes</span>
                </div>
                <ul className="pick-list">
                  {filteredEpisodes.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="pick-list__row" onClick={() => pickEpisode(e)}>
                        <span className="pick-list__title">
                          {e.index}. {e.title}
                        </span>
                        <span className="pick-list__meta mono">{formatDurationMs(e.duration)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredEpisodes.length === 0 ? <p className="empty quiet">No episodes match.</p> : null}
              </div>
            ) : null}

            {showMarkerEditor && (library?.type === 1 ? movie : episode) ? (
              <div className="panel marker-panel">
                <MarkerTableSection
                  key={`${metaId}-${markerTableRemountSeq}`}
                  rows={draftMarkers}
                  disabled={markerSaving}
                  runtimeMs={editorRuntimeMs}
                  onQueueIntro={queueIntroDraft}
                  onQueueCredits={queueCreditsDraft}
                  onUpdateRow={updateDraftRow}
                  onSetCreditsFinal={setCreditsFinalExclusive}
                  onDeleteRow={removeDraftRow}
                  onSwapPair={swapDraftMarkerPair}
                  onTimeEditsUnresolvedChange={onMarkerTimesUnresolvedChange}
                />
              </div>
            ) : null}
          </>
            ) : null}
          </>
        ) : null}
      </main>

      {showMarkerDock ? (
        <div className="marker-dock" role="region" aria-label="Unsaved marker edits">
          <div className="marker-dock__inner">
            <span className="marker-dock__status quiet">
              Unsaved marker changes.
              {markerTimesUnresolved ? <> Fix or complete times before saving.</> : null}
            </span>
            <div className="marker-dock__actions">
              <button type="button" className="btn btn--ghost" disabled={markerSaving} onClick={discardMarkerDraft}>
                Discard
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={markerSaving || markerTimesUnresolved}
                onClick={() => void saveMarkerDraft()}
              >
                Save
              </button>
            </div>
            {markerSaveError ? (
              <p className="panel__error marker-dock__error" role="alert">
                {markerSaveError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultCreditsTimesFromRuntime(runtimeMs: number): { startMs: number; endMs: number } {
  const endMs = Math.round(runtimeMs);
  const startMs = Math.max(0, endMs - INTRO_DEFAULT_SPAN_MS);
  return { startMs, endMs };
}

function MarkerTableSection({
  rows,
  disabled,
  runtimeMs,
  onQueueIntro,
  onQueueCredits,
  onUpdateRow,
  onSetCreditsFinal,
  onDeleteRow,
  onSwapPair,
  onTimeEditsUnresolvedChange,
}: {
  rows: MarkerRow[];
  disabled: boolean;
  runtimeMs: number | null;
  onQueueIntro: (startMs: number, endMs: number) => void;
  onQueueCredits: (startMs: number, endMs: number, creditsFinal: boolean) => void;
  onUpdateRow: (id: number, patch: Partial<MarkerRow>) => void;
  onSetCreditsFinal: (id: number, final: boolean) => void;
  onDeleteRow: (id: number) => void;
  onSwapPair: (idA: number, idB: number) => void;
  onTimeEditsUnresolvedChange: (active: boolean) => void;
}) {
  const introRows = useMemo(() => sortMarkersForSection(rows.filter((r) => r.marker_type === 'intro')), [rows]);
  const creditsRows = useMemo(() => sortMarkersForSection(rows.filter((r) => r.marker_type === 'credits')), [rows]);

  const unresolvedRowIdsRef = useRef<Set<number>>(new Set());

  const reportRowTimeState = useCallback(
    (rowId: number, unresolved: boolean) => {
      if (unresolved) {
        unresolvedRowIdsRef.current.add(rowId);
      } else {
        unresolvedRowIdsRef.current.delete(rowId);
      }
      onTimeEditsUnresolvedChange(unresolvedRowIdsRef.current.size > 0);
    },
    [onTimeEditsUnresolvedChange],
  );

  useLayoutEffect(() => {
    const aliveIds: number[] = rows.map((r) => r.id);
    const alive = new Set(aliveIds);
    let touched = false;
    for (const id of [...unresolvedRowIdsRef.current]) {
      if (!alive.has(id)) {
        unresolvedRowIdsRef.current.delete(id);
        touched = true;
      }
    }
    if (touched) {
      onTimeEditsUnresolvedChange(unresolvedRowIdsRef.current.size > 0);
    }
  }, [rows, onTimeEditsUnresolvedChange]);

  const canAddCredits = runtimeMs != null && Number.isFinite(runtimeMs) && runtimeMs > 0;

  const addIntroDefaults = useCallback(() => {
    if (runtimeMs != null && Number.isFinite(runtimeMs) && runtimeMs > 0) {
      const end = Math.min(INTRO_DEFAULT_SPAN_MS, Math.floor(runtimeMs));
      if (!Number.isFinite(end) || end <= 0) {
        return;
      }
      onQueueIntro(0, end);
      return;
    }
    onQueueIntro(0, INTRO_DEFAULT_SPAN_MS);
  }, [onQueueIntro, runtimeMs]);

  const addCreditsDefaults = useCallback(() => {
    if (!canAddCredits || runtimeMs == null) {
      return;
    }
    const { startMs, endMs } = defaultCreditsTimesFromRuntime(runtimeMs);
    onQueueCredits(startMs, endMs, false);
  }, [canAddCredits, onQueueCredits, runtimeMs]);

  return (
    <>
      <section className="marker-section">
        <div className="marker-section__header">
          <h3 className="marker-section__title">Intro Markers</h3>
        </div>
        <div className="table-wrap">
          <table className="marker-table">
            <colgroup>
              <col className="marker-table__cw-order" />
              <col />
              <col />
              <col className="marker-table__cw-final" />
              <col className="marker-table__cw-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col" className="marker-table__col-final-slot marker-table__th-final-placeholder" aria-hidden />
                <th scope="col" className="marker-table__th-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--small marker-table__add-header"
                    disabled={disabled}
                    onClick={addIntroDefaults}
                    title={
                      runtimeMs != null && Number.isFinite(runtimeMs) && runtimeMs > 0
                        ? `Add intro (0 → ${formatDurationMs(Math.min(INTRO_DEFAULT_SPAN_MS, Math.floor(runtimeMs)))})`
                        : 'Add intro (0 → 90s)'
                    }
                    aria-label="Add intro marker (0 through 90 seconds or end of playback, whichever is shorter)"
                  >
                    + Add
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {introRows.map((row, i) => (
                <IntroMarkerRow
                  key={row.id}
                  row={row}
                  runtimeMs={runtimeMs}
                  disabled={disabled}
                  onUpdateRow={onUpdateRow}
                  onDeleteRow={onDeleteRow}
                  onRowTimeStateChange={reportRowTimeState}
                  canMoveUp={i > 0}
                  canMoveDown={i < introRows.length - 1}
                  onMoveUp={() => {
                    onSwapPair(row.id, introRows[i - 1]!.id);
                  }}
                  onMoveDown={() => {
                    onSwapPair(row.id, introRows[i + 1]!.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        {introRows.length === 0 ? (
          <p className="empty quiet marker-section__empty">No intro markers yet — use + Add on the right (defaults 0–90s).</p>
        ) : null}
      </section>

      <section className="marker-section">
        <div className="marker-section__header">
          <h3 className="marker-section__title">Credits Markers</h3>
        </div>
        <div className="table-wrap">
          <table className="marker-table">
            <colgroup>
              <col className="marker-table__cw-order" />
              <col />
              <col />
              <col className="marker-table__cw-final" />
              <col className="marker-table__cw-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th
                  scope="col"
                  className="marker-table__col-final-slot"
                  title="Only one credits row may be Final; Plex extends that block to end-of-media"
                >
                  Final
                </th>
                <th scope="col" className="marker-table__th-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--small marker-table__add-header"
                    disabled={disabled || !canAddCredits}
                    onClick={addCreditsDefaults}
                    title={
                      canAddCredits && runtimeMs != null
                        ? `Last 90s before end (${formatDurationMs(runtimeMs)} runtime)`
                        : 'Duration unknown — cannot add credits with defaults'
                    }
                    aria-label="Add credits marker (90 seconds before end of runtime through end)"
                  >
                    + Add
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {creditsRows.map((row, i) => (
                <CreditsMarkerRow
                  key={row.id}
                  row={row}
                  runtimeMs={runtimeMs}
                  disabled={disabled}
                  onUpdateRow={onUpdateRow}
                  onSetCreditsFinal={onSetCreditsFinal}
                  onDeleteRow={onDeleteRow}
                  onRowTimeStateChange={reportRowTimeState}
                  canMoveUp={i > 0}
                  canMoveDown={i < creditsRows.length - 1}
                  onMoveUp={() => {
                    onSwapPair(row.id, creditsRows[i - 1]!.id);
                  }}
                  onMoveDown={() => {
                    onSwapPair(row.id, creditsRows[i + 1]!.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        {creditsRows.length === 0 ? (
          <p className="empty quiet marker-section__empty">
            No credits markers yet — use + Add on the right (defaults to the last 90s of runtime).
          </p>
        ) : null}
      </section>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
