import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  SkipBack,
  SkipForward,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatBytes, pdfjsLib } from '../lib/offlineStorage';
import { fetchAndCacheSongPdf } from '../lib/songSync';
import type { BandSong } from '../types';

interface PdfReaderModalProps {
  song: BandSong;
  onClose: () => void;
  setlistContext?: {
    eventTitle: string;
    songs: BandSong[];
    currentIndex: number;
    onSelectSongIndex: (index: number) => void;
  };
  onCachedUpdate?: () => void;
}

export const PdfReaderModal: React.FC<PdfReaderModalProps> = ({
  song,
  onClose,
  setlistContext,
  onCachedUpdate,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(song.pageCount || 1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [stageMode, setStageMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Measure viewport width so 100% zoom fits comfortably on mobile & desktop
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const padding = window.innerWidth < 640 ? 24 : 48;
      setContainerWidth(Math.max(280, Math.min(920, el.clientWidth - padding)));
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load PDF bytes (offline cache first, then Firestore)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    setPageNumber(1);
    setNumPages(song.pageCount || 1);
    setPdfBytes(null);
    scrollContainerRef.current?.scrollTo({ top: 0 });

    fetchAndCacheSongPdf(song)
      .then((bytes) => {
        if (cancelled) return;
        setPdfBytes(bytes);
        setLoading(false);
        onCachedUpdate?.();
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Impossibile aprire lo spartito offline. Connettiti una volta per salvarlo.',
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [song.id, song.updatedAtMs]);

  // Render ALL pages vertically so the user can scroll continuously up & down
  useEffect(() => {
    if (!pdfBytes) return;
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    const renderAllPages = async () => {
      try {
        const copy = new Uint8Array(pdfBytes.byteLength);
        copy.set(pdfBytes);
        loadingTask = pdfjsLib.getDocument({ data: copy });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        if (pdfDoc.numPages !== numPages) {
          setNumPages(pdfDoc.numPages);
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageIdx = 1; pageIdx <= pdfDoc.numPages; pageIdx++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(pageIdx);
          if (cancelled) return;

          const canvas = canvasRefs.current[pageIdx - 1];
          if (!canvas) continue;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          const baseViewport = page.getViewport({ scale: 1 });
          const fitScale = containerWidth / baseViewport.width;
          const viewport = page.getViewport({ scale: fitScale * zoom });

          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Errore nel rendering del PDF.');
        }
      }
    };

    void renderAllPages();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [pdfBytes, numPages, zoom, containerWidth]);

  const scrollToPage = useCallback(
    (targetPage: number) => {
      const clamped = Math.max(1, Math.min(numPages, targetPage));
      setPageNumber(clamped);
      const wrapper = pageWrapperRefs.current[clamped - 1];
      if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [numPages],
  );

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    let closestPage = 1;
    let smallestDist = Infinity;
    for (let i = 0; i < numPages; i++) {
      const el = pageWrapperRefs.current[i];
      if (!el) continue;
      const dist = Math.abs(el.getBoundingClientRect().top - containerTop - 16);
      if (dist < smallestDist) {
        smallestDist = dist;
        closestPage = i + 1;
      }
    }
    if (closestPage !== pageNumber) {
      setPageNumber(closestPage);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') scrollToPage(pageNumber + 1);
      if (e.key === 'ArrowLeft') scrollToPage(pageNumber - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pageNumber, scrollToPage, onClose]);

  const handleDownloadPdf = () => {
    if (!pdfBytes) return;
    const copy = new Uint8Array(pdfBytes.byteLength);
    copy.set(pdfBytes);
    const blob = new Blob([copy.buffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = song.fileName || `${song.title}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const hasPrevSong = setlistContext && setlistContext.currentIndex > 0;
  const hasNextSong =
    setlistContext && setlistContext.currentIndex < setlistContext.songs.length - 1;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden ${
        stageMode ? 'bg-[#090B10] text-zinc-50' : 'bg-[#F5F6F8] text-zinc-950'
      }`}
    >
      {/* Top Reader Toolbar */}
      <header
        className={`shrink-0 flex items-center justify-between gap-3 px-3 sm:px-6 py-2.5 border-b ${
          stageMode
            ? 'border-zinc-800 bg-[#0E1118]/95 text-zinc-50'
            : 'border-zinc-200 bg-white text-zinc-950'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi leggio"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-500/15 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold truncate">
              {song.title}
            </h2>
            <p className="text-xs opacity-70 truncate">
              {setlistContext
                ? `${setlistContext.eventTitle} · Brano ${setlistContext.currentIndex + 1}/${setlistContext.songs.length}`
                : [
                    song.artist || 'Band',
                    song.musicalKey || null,
                    song.bpm ? `${song.bpm} BPM` : null,
                    formatBytes(song.fileSizeBytes),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
            aria-label="Riduci zoom"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-500/15"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="hidden sm:inline text-xs font-mono tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.25, Number((z + 0.15).toFixed(2))))}
            aria-label="Aumenta zoom"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-500/15"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setStageMode((v) => !v)}
            aria-label={stageMode ? 'Sfondo chiaro' : 'Modalità palco scura'}
            title={stageMode ? 'Sfondo chiaro' : 'Modalità palco scura'}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-500/15"
          >
            {stageMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {pdfBytes && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              aria-label="Scarica PDF"
              title="Scarica file PDF"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-500/15"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Vertically Scrollable Multi-Page PDF Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-auto overscroll-contain touch-pan-x touch-pan-y p-3 sm:p-6"
      >
        <div className="min-h-full flex flex-col items-center">
          {song.notes && (
            <div
              className={`w-full max-w-3xl mb-4 rounded-xl px-4 py-2.5 text-xs sm:text-sm ${
                stageMode
                  ? 'bg-[#11141C] text-blue-300 border border-zinc-800'
                  : 'bg-blue-50 text-blue-900 border border-blue-200'
              }`}
            >
              Note palco: {song.notes}
            </div>
          )}

          {loading && (
            <div className="my-auto text-center space-y-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm opacity-75">Caricamento spartito PDF...</p>
            </div>
          )}

          {!loading && errorMsg && (
            <div className="my-auto max-w-sm text-center space-y-3 p-6 rounded-2xl border border-zinc-700/40">
              <WifiOff className="w-8 h-8 text-blue-500 mx-auto" />
              <p className="text-sm leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && pdfBytes && (
            <div className="flex flex-col items-center gap-4 pb-6">
              {Array.from({ length: numPages }, (_, idx) => (
                <div
                  key={`${song.id}-page-${idx + 1}`}
                  ref={(el) => {
                    pageWrapperRefs.current[idx] = el;
                  }}
                  className="rounded-lg overflow-hidden shadow-2xl bg-white"
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[idx] = el;
                    }}
                    className="block"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls: Page Jumper + Setlist Song Switcher */}
      <footer
        className={`shrink-0 border-t px-4 py-2.5 pb-safe flex flex-wrap items-center justify-between gap-3 ${
          stageMode
            ? 'border-zinc-800 bg-[#0E1118]/95 text-zinc-50'
            : 'border-zinc-200 bg-white text-zinc-950'
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => scrollToPage(pageNumber - 1)}
            className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-xl border border-zinc-600/30 text-xs font-semibold disabled:opacity-35 whitespace-nowrap"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Pag. prec.</span>
          </button>
          <span className="text-xs font-mono tabular-nums px-2">
            {pageNumber} / {numPages}
          </span>
          <button
            type="button"
            disabled={pageNumber >= numPages}
            onClick={() => scrollToPage(pageNumber + 1)}
            className="min-h-[44px] px-3 inline-flex items-center gap-1 rounded-xl border border-zinc-600/30 text-xs font-semibold disabled:opacity-35 whitespace-nowrap"
          >
            <span>Pag. succ.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {setlistContext && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              disabled={!hasPrevSong}
              onClick={() => setlistContext.onSelectSongIndex(setlistContext.currentIndex - 1)}
              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold disabled:opacity-35 whitespace-nowrap"
            >
              <SkipBack className="w-4 h-4" />
              <span>Brano prec.</span>
            </button>
            <button
              type="button"
              disabled={!hasNextSong}
              onClick={() => setlistContext.onSelectSongIndex(setlistContext.currentIndex + 1)}
              className="min-h-[44px] px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-35 whitespace-nowrap"
            >
              <span>Prossimo brano</span>
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
};
