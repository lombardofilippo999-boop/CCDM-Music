import React, { useState } from 'react';
import { CheckCircle2, FileUp, Plus, Trash2, X } from 'lucide-react';
import { formatBytes } from '../lib/offlineStorage';
import { deleteSongAndChunks, saveSongWithPdf } from '../lib/songSync';
import { VALIDATION_LIMITS, type BandMember, type BandSong } from '../types';

interface SongFormModalProps {
  existingSong?: BandSong | null;
  currentMember: BandMember;
  onClose: () => void;
  onSaved: () => void;
}

interface BatchPdfItem {
  localId: string;
  file: File;
  title: string;
  artist: string;
  genre: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

function titleFromFileName(name: string): string {
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/[_]+/g, ' ')
      .trim()
      .slice(0, VALIDATION_LIMITS.songTitleMax) || 'Spartito'
  );
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export const SongFormModal: React.FC<SongFormModalProps> = ({
  existingSong,
  currentMember,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(existingSong);
  const isAdmin = currentMember.role === 'admin';
  const allowMultiple = isAdmin && !isEdit;

  // Single-song state
  const [title, setTitle] = useState(existingSong?.title ?? '');
  const [artist, setArtist] = useState(existingSong?.artist ?? '');
  const [musicalKey, setMusicalKey] = useState(existingSong?.musicalKey ?? '');
  const [bpm, setBpm] = useState(existingSong?.bpm ? String(existingSong.bpm) : '');
  const [duration, setDuration] = useState(existingSong?.duration ?? '');
  const [genre, setGenre] = useState(existingSong?.genre ?? '');
  const [notes, setNotes] = useState(existingSong?.notes ?? '');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Admin batch upload state
  const [batchItems, setBatchItems] = useState<BatchPdfItem[]>([]);
  const [sharedArtist, setSharedArtist] = useState('');
  const [sharedGenre, setSharedGenre] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isBatchMode = allowMultiple && batchItems.length > 1;

  const processIncomingFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setErrorMsg(null);

    const validPdfs: File[] = [];
    const rejectedNames: string[] = [];

    for (const file of incoming) {
      if (!isPdfFile(file)) {
        rejectedNames.push(`${file.name} (non è un PDF)`);
        continue;
      }
      if (file.size === 0 || file.size > VALIDATION_LIMITS.maxPdfBytes) {
        rejectedNames.push(`${file.name} (supera 15 MB)`);
        continue;
      }
      validPdfs.push(file);
    }

    if (rejectedNames.length > 0) {
      setErrorMsg(`File ignorati: ${rejectedNames.join(', ')}.`);
    }

    if (validPdfs.length === 0) return;

    // Single file mode when only 1 total file and not already in batch mode
    if (!allowMultiple || (validPdfs.length === 1 && batchItems.length === 0 && !pdfFile)) {
      const first = validPdfs[0];
      setPdfFile(first);
      if (!title.trim()) {
        setTitle(titleFromFileName(first.name));
      }
      return;
    }

    // Transition existing single file (if any) + newly added files into batch queue
    setBatchItems((prev) => {
      const next = [...prev];
      if (next.length === 0 && pdfFile) {
        next.push({
          localId: `${Date.now()}_0`,
          file: pdfFile,
          title: title.trim() || titleFromFileName(pdfFile.name),
          artist: artist.trim(),
          genre: genre.trim(),
          status: 'pending',
        });
      }
      validPdfs.forEach((f, idx) => {
        next.push({
          localId: `${Date.now()}_${next.length}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          file: f,
          title: titleFromFileName(f.name),
          artist: sharedArtist.trim(),
          genre: sharedGenre.trim(),
          status: 'pending',
        });
      });
      return next;
    });
    setPdfFile(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processIncomingFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processIncomingFiles(e.dataTransfer.files);
    }
  };

  const updateBatchItem = (localId: string, patch: Partial<BatchPdfItem>) => {
    setBatchItems((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const removeBatchItem = (localId: string) => {
    setBatchItems((prev) => {
      const remaining = prev.filter((item) => item.localId !== localId);
      if (remaining.length === 1 && remaining[0].status === 'pending') {
        setPdfFile(remaining[0].file);
        setTitle(remaining[0].title);
        setArtist(remaining[0].artist);
        setGenre(remaining[0].genre);
        return [];
      }
      return remaining;
    });
  };

  const applySharedFields = () => {
    setBatchItems((prev) =>
      prev.map((item) =>
        item.status === 'done'
          ? item
          : {
              ...item,
              artist: sharedArtist.trim() || item.artist,
              genre: sharedGenre.trim() || item.genre,
            },
      ),
    );
  };

  const handleSubmitSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Inserisci il titolo del brano.');
      return;
    }
    if (!isEdit && !pdfFile) {
      setErrorMsg('Seleziona il file PDF dello spartito.');
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      await saveSongWithPdf({
        existingSong: existingSong ?? undefined,
        title,
        artist,
        musicalKey,
        bpm: Number(bpm) || 0,
        duration,
        genre,
        notes,
        pdfFile,
        uploaderUid: currentMember.uid,
        uploaderName: currentMember.displayName,
      });
      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore durante il salvataggio del brano.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const toUpload = batchItems.filter((item) => item.status !== 'done');
    if (toUpload.length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    let anySuccess = false;
    let failures = 0;

    for (const item of toUpload) {
      const cleanTitle = item.title.trim() || titleFromFileName(item.file.name);
      updateBatchItem(item.localId, { status: 'uploading', error: undefined });
      try {
        await saveSongWithPdf({
          title: cleanTitle,
          artist: item.artist.trim() || sharedArtist.trim(),
          musicalKey: '',
          bpm: 0,
          duration: '',
          genre: item.genre.trim() || sharedGenre.trim(),
          notes: '',
          pdfFile: item.file,
          uploaderUid: currentMember.uid,
          uploaderName: currentMember.displayName,
        });
        updateBatchItem(item.localId, { status: 'done' });
        anySuccess = true;
      } catch (err) {
        failures++;
        updateBatchItem(item.localId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Errore caricamento',
        });
      }
    }

    if (anySuccess) {
      onSaved();
    }
    setBusy(false);

    if (failures === 0) {
      onClose();
    } else {
      setErrorMsg(`${failures} file non caricati. Puoi correggere o riprovare solo quelli in errore.`);
    }
  };

  const handleDelete = async () => {
    if (!existingSong) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await deleteSongAndChunks(existingSong.id);
      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossibile eliminare il brano.');
      setBusy(false);
    }
  };

  const completedCount = batchItems.filter((i) => i.status === 'done').length;
  const pendingCount = batchItems.filter((i) => i.status !== 'done').length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm">
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-4">
        <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#11141C] border border-zinc-200 dark:border-zinc-800">
          <div className="shrink-0 px-6 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-10 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-zinc-950 dark:text-zinc-50">
                  {isEdit
                    ? 'Modifica brano PDF'
                    : isBatchMode
                      ? `Caricamento multiplo (${batchItems.length} PDF)`
                      : 'Carica spartiti PDF'}
                </h2>
                {allowMultiple && !isBatchMode && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Come Amministratore puoi selezionare o trascinare più file PDF insieme.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                aria-label="Chiudi"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto overscroll-contain max-h-[calc(90dvh-5.25rem)] p-6 space-y-5">
            {/* Dropzone / File Picker */}
            {!isBatchMode ? (
              <form onSubmit={(e) => void handleSubmitSingle(e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                    {isEdit
                      ? 'Sostituisci file PDF (opzionale)'
                      : allowMultiple
                        ? 'File PDF (singolo o selezione multipla, max 15 MB ciascuno)'
                        : 'File spartito PDF (max 15 MB)'}
                  </label>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`min-h-[76px] flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3 cursor-pointer transition-colors ${
                      isDragging
                        ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                        : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-[#090B10] hover:border-blue-500'
                    }`}
                  >
                    <FileUp className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {pdfFile
                          ? pdfFile.name
                          : existingSong
                            ? `Attuale: ${existingSong.fileName}`
                            : allowMultiple
                              ? 'Tocca o trascina uno o più file PDF'
                              : 'Tocca per scegliere un PDF dal dispositivo'}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {pdfFile
                          ? `${formatBytes(pdfFile.size)}${allowMultiple ? ' · Seleziona altri PDF per caricarli in blocco' : ''}`
                          : existingSong
                            ? `${formatBytes(existingSong.fileSizeBytes)} · ${existingSong.pageCount} pag.`
                            : 'Verranno salvati anche nella memoria offline'}
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple={allowMultiple}
                      onChange={handleFileChange}
                      className="sr-only"
                    />
                  </label>

                  {allowMultiple && pdfFile && (
                    <label className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Aggiungi altri file PDF da caricare insieme</span>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        multiple
                        onChange={handleFileChange}
                        className="sr-only"
                      />
                    </label>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                      Titolo brano
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={VALIDATION_LIMITS.songTitleMax}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Es. Yeshua"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                      Artista / Autore
                    </label>
                    <input
                      type="text"
                      maxLength={VALIDATION_LIMITS.songArtistMax}
                      value={artist}
                      onChange={(e) => setArtist(e.target.value)}
                      placeholder="Es. Hillsong"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Tonalità
                    </label>
                    <input
                      type="text"
                      maxLength={VALIDATION_LIMITS.musicalKeyMax}
                      value={musicalKey}
                      onChange={(e) => setMusicalKey(e.target.value)}
                      placeholder="Dm"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm font-mono text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      BPM
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={VALIDATION_LIMITS.bpmMax}
                      value={bpm}
                      onChange={(e) => setBpm(e.target.value)}
                      placeholder="120"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm font-mono tabular-nums text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Durata
                    </label>
                    <input
                      type="text"
                      maxLength={VALIDATION_LIMITS.durationMax}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      placeholder="04:30"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm font-mono tabular-nums text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Genere
                    </label>
                    <input
                      type="text"
                      maxLength={VALIDATION_LIMITS.genreMax}
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="Worship"
                      className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                    Note esecuzione / palco
                  </label>
                  <textarea
                    rows={2}
                    maxLength={VALIDATION_LIMITS.notesMax}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Es. Capotasto al 2° tasto, intro solo batteria..."
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 py-2.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {errorMsg && (
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {errorMsg}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  {isEdit && !confirmDelete && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-xl border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Elimina brano</span>
                    </button>
                  )}

                  {isEdit && confirmDelete && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete()}
                        className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 whitespace-nowrap"
                      >
                        Conferma eliminazione
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                        className="min-h-[44px] px-3 rounded-xl text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                      >
                        Annulla
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onClose}
                      className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {busy ? 'Salvataggio...' : isEdit ? 'Salva modifiche' : 'Carica spartito'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              /* Admin Batch Multi-PDF Upload View */
              <form onSubmit={(e) => void handleSubmitBatch(e)} className="space-y-4">
                {/* Add more files / Dropzone */}
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`min-h-[56px] flex items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-2.5 cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-[#090B10] hover:border-blue-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    <Plus className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Aggiungi o trascina altri file PDF nella coda</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                    {completedCount}/{batchItems.length} completati
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    disabled={busy}
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>

                {/* Shared Default Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end rounded-2xl bg-zinc-50 dark:bg-[#090B10] border border-zinc-200 dark:border-zinc-800 p-3.5">
                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Artista comune (opzionale)
                    </label>
                    <input
                      type="text"
                      disabled={busy}
                      maxLength={VALIDATION_LIMITS.songArtistMax}
                      value={sharedArtist}
                      onChange={(e) => setSharedArtist(e.target.value)}
                      placeholder="Es. Hillsong"
                      className="w-full min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#11141C] px-3 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Genere comune (opzionale)
                    </label>
                    <input
                      type="text"
                      disabled={busy}
                      maxLength={VALIDATION_LIMITS.genreMax}
                      value={sharedGenre}
                      onChange={(e) => setSharedGenre(e.target.value)}
                      placeholder="Es. Worship"
                      className="w-full min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#11141C] px-3 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={applySharedFields}
                      className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#11141C] text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      Applica a tutti
                    </button>
                  </div>
                </div>

                {/* Queued PDF Items */}
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 max-h-72 overflow-y-auto pr-1">
                  {batchItems.map((item, idx) => (
                    <div
                      key={item.localId}
                      className="py-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
                    >
                      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <div className="sm:col-span-7 flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold w-5 shrink-0">
                            {idx + 1}.
                          </span>
                          <input
                            type="text"
                            required
                            disabled={busy || item.status === 'done'}
                            maxLength={VALIDATION_LIMITS.songTitleMax}
                            value={item.title}
                            onChange={(e) =>
                              updateBatchItem(item.localId, { title: e.target.value })
                            }
                            placeholder="Es. Yeshua"
                            className="w-full min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm font-medium text-zinc-950 dark:text-zinc-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            disabled={busy || item.status === 'done'}
                            maxLength={VALIDATION_LIMITS.songArtistMax}
                            value={item.artist}
                            onChange={(e) =>
                              updateBatchItem(item.localId, { artist: e.target.value })
                            }
                            placeholder={sharedArtist.trim() || 'Es. Hillsong'}
                            className="w-full min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm text-zinc-950 dark:text-zinc-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pl-7 sm:pl-0">
                        <div className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                          {item.status === 'pending' && formatBytes(item.file.size)}
                          {item.status === 'uploading' && (
                            <span className="text-blue-600 dark:text-blue-400 font-sans font-semibold">
                              Caricamento...
                            </span>
                          )}
                          {item.status === 'done' && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-sans font-semibold inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Caricato
                            </span>
                          )}
                          {item.status === 'error' && (
                            <span className="text-red-600 dark:text-red-400 font-sans font-semibold">
                              Errore
                            </span>
                          )}
                        </div>

                        {!busy && item.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() => removeBatchItem(item.localId)}
                            aria-label={`Rimuovi ${item.title}`}
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {item.error && (
                        <p className="text-xs text-red-600 dark:text-red-400 pl-7 sm:hidden">
                          {item.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {errorMsg && (
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {errorMsg}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBatchItems([])}
                    className="min-h-[44px] px-3.5 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200"
                  >
                    Svuota coda
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onClose}
                      className="min-h-[44px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      disabled={busy || pendingCount === 0}
                      className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {busy
                        ? `Caricamento (${completedCount}/${batchItems.length})...`
                        : `Carica ${pendingCount} PDF`}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
