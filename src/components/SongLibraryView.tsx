import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  DownloadCloud,
  Edit3,
  FileText,
  Moon,
  Music,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { formatBytes } from '../lib/offlineStorage';
import { deleteSongAndChunks, fetchAndCacheSongPdf } from '../lib/songSync';
import type { BandMember, BandSong } from '../types';

interface SongLibraryViewProps {
  songs: BandSong[];
  currentMember: BandMember;
  cachedMap: Record<string, { updatedAtMs: number; sizeBytes: number }>;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenSong: (song: BandSong) => void;
  onAddSong: () => void;
  onEditSong: (song: BandSong) => void;
  onCacheUpdated: () => void;
}

export const SongLibraryView: React.FC<SongLibraryViewProps> = ({
  songs,
  currentMember,
  cachedMap,
  darkMode,
  onToggleDarkMode,
  onOpenSong,
  onAddSong,
  onEditSong,
  onCacheUpdated,
}) => {
  const canEdit = currentMember.role === 'admin' || currentMember.role === 'editor';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'offline'>('all');
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [confirmDeleteSong, setConfirmDeleteSong] = useState<BandSong | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSongCached = (song: BandSong) =>
    Boolean(cachedMap[song.id] && cachedMap[song.id].updatedAtMs >= song.updatedAtMs);

  const cachedCount = useMemo(
    () => songs.filter((s) => isSongCached(s)).length,
    [songs, cachedMap],
  );

  const filteredSongs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return songs.filter((song) => {
      if (filterMode === 'offline' && !isSongCached(song)) {
        return false;
      }
      if (!q) return true;
      return (
        song.title.toLowerCase().includes(q) ||
        song.artist.toLowerCase().includes(q) ||
        song.musicalKey.toLowerCase().includes(q) ||
        song.genre.toLowerCase().includes(q) ||
        song.notes.toLowerCase().includes(q) ||
        String(song.bpm).includes(q)
      );
    });
  }, [songs, searchQuery, filterMode, cachedMap]);

  const handleSyncAllOffline = async () => {
    const missing = songs.filter((s) => !isSongCached(s));
    if (missing.length === 0) return;
    setSyncingAll(true);
    let idx = 0;
    try {
      for (const s of missing) {
        idx++;
        setSyncProgress(`${idx}/${missing.length}`);
        await fetchAndCacheSongPdf(s);
      }
      onCacheUpdated();
    } finally {
      setSyncingAll(false);
      setSyncProgress('');
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteSong) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSongAndChunks(confirmDeleteSong.id);
      onCacheUpdated();
      setConfirmDeleteSong(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Impossibile eliminare il brano.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Workspace Header & Actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50"
            style={{ textWrap: 'balance' }}
          >
            Libreria Spartiti PDF
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 font-mono tabular-nums">
            {songs.length} brani totali · {cachedCount} disponibili offline
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Passa al tema chiaro' : 'Passa al tema Stage Midnight'}
            className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4 text-blue-500" /> : <Moon className="w-4 h-4 text-blue-600" />}
            <span>{darkMode ? 'Chiaro' : 'Palco'}</span>
          </button>

          {songs.length > 0 && cachedCount < songs.length && (
            <button
              type="button"
              disabled={syncingAll}
              onClick={() => void handleSyncAllOffline()}
              className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <DownloadCloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>{syncingAll ? `Salvataggio ${syncProgress}...` : 'Salva tutti offline'}</span>
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={onAddSong}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Carica PDF</span>
            </button>
          )}
        </div>
      </div>

      {/* Instant Search & Segmented Filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca subito per titolo, artista, tonalità, BPM o genere..."
            aria-label="Cerca brani nella libreria"
            className="w-full min-h-[46px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] pl-10 pr-10 text-sm text-zinc-950 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Cancella ricerca"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-200/75 dark:bg-[#11141C] border border-transparent dark:border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              filterMode === 'all'
                ? 'bg-white dark:bg-blue-600 text-zinc-950 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
            }`}
          >
            Tutti ({songs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('offline')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              filterMode === 'offline'
                ? 'bg-white dark:bg-blue-600 text-zinc-950 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
            }`}
          >
            Offline ({cachedCount})
          </button>
        </div>
      </div>

      {/* Empty States */}
      {songs.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-10 text-center space-y-3">
          <Music className="w-10 h-10 text-zinc-400 dark:text-zinc-500 mx-auto" />
          <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
            La libreria è ancora vuota
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            {canEdit
              ? 'Carica il primo spartito PDF della band: sarà subito disponibile a tutti e salvabile offline.'
              : 'L’amministratore o gli editor non hanno ancora caricato spartiti PDF.'}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={onAddSong}
              className="mt-2 min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Carica il primo brano</span>
            </button>
          )}
        </div>
      ) : filteredSongs.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Nessun brano trovato
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Prova a cercare con un altro titolo, artista o tonalità.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {filteredSongs.map((song) => {
            const cached = isSongCached(song);
            const hasKey = Boolean(song.musicalKey?.trim());
            return (
              <div
                key={song.id}
                className="group rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-[#11141C] p-4 flex items-start justify-between gap-3 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors active:scale-[0.995]"
              >
                <button
                  type="button"
                  onClick={() => onOpenSong(song)}
                  className="flex items-start gap-3.5 min-w-0 flex-1 text-left"
                >
                  {hasKey ? (
                    <div
                      title={`Tonalità: ${song.musicalKey}`}
                      className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200/80 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5 font-mono text-sm font-bold tracking-tight"
                    >
                      {song.musicalKey.slice(0, 4)}
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/70 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-5 h-5" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-bold text-base text-zinc-950 dark:text-zinc-50 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {song.title}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                      {[
                        song.artist || 'Senza autore',
                        song.genre || null,
                        song.bpm ? `${song.bpm} BPM` : null,
                        song.duration || null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      <span>{song.pageCount} pag.</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(song.fileSizeBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-sans ${
                          cached
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {cached && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                        {cached ? 'Offline' : 'Online'}
                      </span>
                    </div>
                  </div>
                </button>

                {canEdit && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onEditSong(song)}
                      aria-label={`Modifica ${song.title}`}
                      title="Modifica brano"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDeleteSong(song);
                      }}
                      aria-label={`Elimina ${song.title}`}
                      title="Elimina brano"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmDeleteSong && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#11141C] border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
                Eliminare questo brano?
              </h2>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDeleteSong(null)}
                aria-label="Chiudi"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Stai per eliminare definitivamente{' '}
              <strong className="text-zinc-950 dark:text-zinc-50">
                {confirmDeleteSong.title}
              </strong>
              {confirmDeleteSong.artist ? ` (${confirmDeleteSong.artist})` : ''}. Lo spartito PDF
              verrà rimosso dalla libreria per tutta la band.
            </p>

            {deleteError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDeleteSong(null)}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Eliminazione...' : 'Elimina brano'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
