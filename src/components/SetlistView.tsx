import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  ArrowDown,
  ArrowUp,
  DownloadCloud,
  Edit3,
  ListMusic,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { fetchAndCacheSongPdf } from '../lib/songSync';
import {
  BAND_ID,
  VALIDATION_LIMITS,
  type BandMember,
  type BandSong,
  type EventSetlist,
} from '../types';

interface SetlistViewProps {
  setlists: EventSetlist[];
  songs: BandSong[];
  currentMember: BandMember;
  cachedMap: Record<string, { updatedAtMs: number; sizeBytes: number }>;
  onOpenSetlistReader: (setlist: EventSetlist, startIndex: number) => void;
  onCacheUpdated: () => void;
}

const ITALIAN_MONTHS_SHORT = [
  'GEN',
  'FEB',
  'MAR',
  'APR',
  'MAG',
  'GIU',
  'LUG',
  'AGO',
  'SET',
  'OTT',
  'NOV',
  'DIC',
];

function parseDateParts(isoDate: string): { day: string; month: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    return { day: '--', month: 'DATA' };
  }
  const monthIdx = Math.max(0, Math.min(11, Number(match[2]) - 1));
  return {
    day: match[3],
    month: ITALIAN_MONTHS_SHORT[monthIdx] || match[2],
  };
}

export const SetlistView: React.FC<SetlistViewProps> = ({
  setlists,
  songs,
  currentMember,
  cachedMap,
  onOpenSetlistReader,
  onCacheUpdated,
}) => {
  const canEdit = currentMember.role === 'admin' || currentMember.role === 'editor';
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(
    setlists[0]?.id ?? null,
  );
  const [editingModal, setEditingModal] = useState<EventSetlist | 'new' | null>(null);
  const [cachingSetlistId, setCachingSetlistId] = useState<string | null>(null);

  // Modal form fields
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [venue, setVenue] = useState('');
  const [notes, setNotes] = useState('');
  const [songIds, setSongIds] = useState<string[]>([]);
  const [songPickerSearch, setSongPickerSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const songById = useMemo(() => {
    const map = new Map<string, BandSong>();
    for (const s of songs) map.set(s.id, s);
    return map;
  }, [songs]);

  const activeSetlist = useMemo(() => {
    return setlists.find((s) => s.id === selectedSetlistId) || setlists[0] || null;
  }, [setlists, selectedSetlistId]);

  const openEditor = (target: EventSetlist | 'new') => {
    setErrorMsg(null);
    setSongPickerSearch('');
    if (target === 'new') {
      const today = new Date().toISOString().slice(0, 10);
      setEventTitle('');
      setEventDate(today);
      setVenue('');
      setNotes('');
      setSongIds([]);
    } else {
      setEventTitle(target.eventTitle);
      setEventDate(target.eventDate);
      setVenue(target.venue);
      setNotes(target.notes);
      setSongIds(target.songIds);
    }
    setEditingModal(target);
  };

  const filteredSongsForPicker = useMemo(() => {
    const q = songPickerSearch.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.musicalKey.toLowerCase().includes(q),
    );
  }, [songs, songPickerSearch]);

  const moveSong = (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= songIds.length) return;
    const copy = [...songIds];
    const [item] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, item);
    setSongIds(copy);
  };

  const toggleSongInList = (songId: string) => {
    setSongIds((prev) => {
      if (prev.includes(songId)) {
        return prev.filter((id) => id !== songId);
      }
      if (prev.length >= VALIDATION_LIMITS.setlistSongsMax) return prev;
      return [...prev, songId];
    });
  };

  const handleSaveSetlist = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = eventTitle.trim().slice(0, VALIDATION_LIMITS.setlistTitleMax);
    if (!cleanTitle || !eventDate.trim()) {
      setErrorMsg('Inserisci nome evento e data.');
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      const payload = {
        eventTitle: cleanTitle,
        eventDate: eventDate.trim().slice(0, 32),
        venue: venue.trim().slice(0, VALIDATION_LIMITS.setlistVenueMax),
        notes: notes.trim().slice(0, VALIDATION_LIMITS.notesMax),
        songIds: songIds.slice(0, VALIDATION_LIMITS.setlistSongsMax),
        updatedAt: serverTimestamp(),
      };

      if (editingModal === 'new') {
        const newId = `setlist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await setDoc(doc(db, 'setlists', newId), {
          id: newId,
          bandId: BAND_ID,
          ...payload,
          createdByUid: currentMember.uid,
          createdByName: currentMember.displayName.slice(0, VALIDATION_LIMITS.displayNameMax),
          createdAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `setlists/${newId}`));
        setSelectedSetlistId(newId);
      } else if (editingModal) {
        await updateDoc(doc(db, 'setlists', editingModal.id), payload).catch((err) =>
          handleFirestoreError(err, OperationType.UPDATE, `setlists/${editingModal.id}`),
        );
      }
      setEditingModal(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore nel salvataggio della scaletta.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSetlist = async (setlistId: string) => {
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'setlists', setlistId)).catch((err) =>
        handleFirestoreError(err, OperationType.DELETE, `setlists/${setlistId}`),
      );
      if (selectedSetlistId === setlistId) setSelectedSetlistId(null);
      setEditingModal(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCacheSetlistOffline = async (setlist: EventSetlist) => {
    setCachingSetlistId(setlist.id);
    try {
      for (const id of setlist.songIds) {
        const s = songById.get(id);
        if (s) {
          await fetchAndCacheSongPdf(s);
        }
      }
      onCacheUpdated();
    } finally {
      setCachingSetlistId(null);
    }
  };

  const activeSongs = useMemo(() => {
    if (!activeSetlist) return [];
    return activeSetlist.songIds
      .map((id) => songById.get(id))
      .filter((s): s is BandSong => Boolean(s));
  }, [activeSetlist, songById]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1
            className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50"
            style={{ textWrap: 'balance' }}
          >
            Scalette Eventi
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Organizza l&apos;ordine dei brani per concerti, serate e prove.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => openEditor('new')}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nuova scaletta</span>
          </button>
        )}
      </div>

      {setlists.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-8 text-center space-y-3">
          <ListMusic className="w-10 h-10 text-zinc-400 dark:text-zinc-500 mx-auto" />
          <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
            Nessuna scaletta creata
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            {canEdit
              ? 'Crea la prima scaletta per il prossimo concerto e aggiungi i brani dalla libreria.'
              : 'Gli editor o l’amministratore non hanno ancora pubblicato scalette per i prossimi eventi.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Setlist Selector Column */}
          <div className="lg:col-span-5 space-y-2.5">
            {setlists.map((setlist) => {
              const isSelected = activeSetlist?.id === setlist.id;
              const dateParts = parseDateParts(setlist.eventDate);
              return (
                <button
                  key={setlist.id}
                  type="button"
                  onClick={() => setSelectedSetlistId(setlist.id)}
                  className={`w-full text-left rounded-2xl border p-4 flex items-center gap-3.5 transition-colors ${
                    isSelected
                      ? 'border-blue-600 dark:border-blue-500 bg-blue-50/75 dark:bg-blue-950/35'
                      : 'border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-[#11141C] hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 font-mono tabular-nums border ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-700/60 text-zinc-800 dark:text-zinc-200'
                    }`}
                  >
                    <span className="text-base font-bold leading-none">{dateParts.day}</span>
                    <span className="text-[10px] font-semibold tracking-wider mt-1 opacity-85 leading-none">
                      {dateParts.month}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display font-bold text-base text-zinc-950 dark:text-zinc-50 truncate">
                        {setlist.eventTitle}
                      </h3>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                        {setlist.songIds.length} brani
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {[setlist.eventDate, setlist.venue || null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Setlist Detail Cue Sheet */}
          {activeSetlist && (
            <div className="lg:col-span-7 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 dark:border-zinc-800/90 pb-4">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                    {activeSetlist.eventTitle}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 font-mono tabular-nums">
                    {[activeSetlist.eventDate, activeSetlist.venue || null, `${activeSongs.length} brani`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {activeSetlist.notes && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-2">
                      {activeSetlist.notes}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeSongs.length > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={cachingSetlistId === activeSetlist.id}
                        onClick={() => void handleCacheSetlistOffline(activeSetlist)}
                        className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                      >
                        <DownloadCloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>
                          {cachingSetlistId === activeSetlist.id ? 'Salvataggio...' : 'Salva offline'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSetlistReader(activeSetlist, 0)}
                        className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <Play className="w-4 h-4" />
                        <span>Avvia Palco</span>
                      </button>
                    </>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditor(activeSetlist)}
                      className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Modifica</span>
                    </button>
                  )}
                </div>
              </div>

              {activeSongs.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
                  Nessun brano inserito in questa scaletta.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {activeSongs.map((song, idx) => {
                    const isOfflineReady = Boolean(
                      cachedMap[song.id] && cachedMap[song.id].updatedAtMs >= song.updatedAtMs,
                    );
                    return (
                      <button
                        key={`${song.id}-${idx}`}
                        type="button"
                        onClick={() => onOpenSetlistReader(activeSetlist, idx)}
                        className="w-full min-h-[60px] py-3 px-2.5 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-7 text-xs font-mono tabular-nums font-bold text-blue-600 dark:text-blue-400 shrink-0">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                              {song.title}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                              {[
                                song.artist || null,
                                song.musicalKey || null,
                                song.bpm ? `${song.bpm} BPM` : null,
                                isOfflineReady ? 'Offline pronto' : 'Solo online',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0 whitespace-nowrap">
                          Apri PDF
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Setlist Create / Edit Modal */}
      {editingModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm">
          <div className="min-h-full flex items-end sm:items-center justify-center sm:p-4">
            <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#11141C] border border-zinc-200 dark:border-zinc-800">
              <div className="shrink-0 px-6 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div className="w-10 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mb-3 sm:hidden" />

                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-display text-xl font-bold text-zinc-950 dark:text-zinc-50">
                    {editingModal === 'new' ? 'Nuova scaletta evento' : 'Modifica scaletta'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditingModal(null)}
                    aria-label="Chiudi"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto overscroll-contain max-h-[calc(90dvh-5.25rem)] p-6">
                <form onSubmit={(e) => void handleSaveSetlist(e)} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                        Nome evento / serata
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={VALIDATION_LIMITS.setlistTitleMax}
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        placeholder="Es. Live Teatro Centrale"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                        Data evento
                      </label>
                      <input
                        type="date"
                        required
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm font-mono text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                        Locale / Luogo
                      </label>
                      <input
                        type="text"
                        maxLength={VALIDATION_LIMITS.setlistVenueMax}
                        value={venue}
                        onChange={(e) => setVenue(e.target.value)}
                        placeholder="Es. Blue Note Milano"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                        Note evento
                      </label>
                      <input
                        type="text"
                        maxLength={VALIDATION_LIMITS.notesMax}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Es. Soundcheck ore 18:30"
                        className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Ordered Song Sequence */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        Ordine brani in scaletta ({songIds.length})
                      </span>
                    </div>
                    {songIds.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3">
                        Seleziona i brani dalla libreria qui sotto per aggiungerli in ordine.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {songIds.map((id, idx) => {
                          const s = songById.get(id);
                          if (!s) return null;
                          return (
                            <div
                              key={`${id}-${idx}`}
                              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#090B10] px-3 py-1.5"
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <span className="text-xs font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                                  {idx + 1}.
                                </span>
                                <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                                  {s.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveSong(idx, -1)}
                                  aria-label="Sposta su"
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === songIds.length - 1}
                                  onClick={() => moveSong(idx, 1)}
                                  aria-label="Sposta giù"
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSongInList(id)}
                                  aria-label="Rimuovi dalla scaletta"
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Song Picker */}
                  <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="relative">
                      <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={songPickerSearch}
                        onChange={(e) => setSongPickerSearch(e.target.value)}
                        placeholder="Cerca brano nella libreria da aggiungere..."
                        className="w-full min-h-[42px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] pl-10 pr-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                      {filteredSongsForPicker.map((s) => {
                        const included = songIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleSongInList(s.id)}
                            className="w-full min-h-[44px] py-2 px-2 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                                {s.title}
                              </p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                {[s.artist || null, s.musicalKey || null].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <span
                              className={`text-xs font-semibold shrink-0 whitespace-nowrap ${
                                included
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : 'text-zinc-500 dark:text-zinc-400'
                              }`}
                            >
                              {included ? 'Aggiunto' : '+ Aggiungi'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    {editingModal !== 'new' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteSetlist(editingModal.id)}
                        className="min-h-[44px] px-4 inline-flex items-center gap-1.5 rounded-xl border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Elimina scaletta</span>
                      </button>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingModal(null)}
                        className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                      >
                        Annulla
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {busy ? 'Salvataggio...' : 'Salva scaletta'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
