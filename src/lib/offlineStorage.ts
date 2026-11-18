import * as pdfjsLib from 'pdfjs-dist';
import type { BandMember, BandSong, EventSetlist } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const DB_NAME = 'leggio-band-offline-v1';
const DB_VERSION = 1;
const STORE_PDFS = 'pdfs';
const STORE_SNAPSHOTS = 'snapshots';

export interface CachedPdfEntry {
  songId: string;
  updatedAtMs: number;
  fileName: string;
  bytes: ArrayBuffer;
  savedAtMs: number;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PDFS)) {
        db.createObjectStore(STORE_PDFS, { keyPath: 'songId' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedPdf(songId: string, expectedUpdatedAtMs?: number): Promise<Uint8Array | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PDFS, 'readonly');
      const req = tx.objectStore(STORE_PDFS).get(songId);
      req.onsuccess = () => {
        const entry = req.result as CachedPdfEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        if (expectedUpdatedAtMs && entry.updatedAtMs < expectedUpdatedAtMs) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(entry.bytes));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveCachedPdf(
  songId: string,
  updatedAtMs: number,
  fileName: string,
  bytes: Uint8Array,
): Promise<void> {
  const db = await openOfflineDb();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const entry: CachedPdfEntry = {
    songId,
    updatedAtMs,
    fileName,
    bytes: copy.buffer,
    savedAtMs: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readwrite');
    tx.objectStore(STORE_PDFS).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteCachedPdf(songId: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PDFS, 'readwrite');
      tx.objectStore(STORE_PDFS).delete(songId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore local cache cleanup error
  }
}

export async function listCachedPdfMeta(): Promise<Record<string, { updatedAtMs: number; sizeBytes: number }>> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PDFS, 'readonly');
      const req = tx.objectStore(STORE_PDFS).getAll();
      req.onsuccess = () => {
        const result: Record<string, { updatedAtMs: number; sizeBytes: number }> = {};
        const rows = (req.result || []) as CachedPdfEntry[];
        for (const row of rows) {
          result[row.songId] = {
            updatedAtMs: row.updatedAtMs,
            sizeBytes: row.bytes.byteLength,
          };
        }
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return {};
  }
}

export async function clearAllCachedPdfs(): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readwrite');
    tx.objectStore(STORE_PDFS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_SNAPSHOTS).put({ key, data, savedAtMs: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore snapshot write error
  }
}

export async function loadSnapshot<T>(key: string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const req = tx.objectStore(STORE_SNAPSHOTS).get(key);
      req.onsuccess = () => {
        const res = req.result as { data: T } | undefined;
        resolve(res ? res.data : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export interface OfflineBundleSnapshot {
  songs: BandSong[];
  setlists: EventSetlist[];
  members: BandMember[];
}

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const loadingTask = pdfjsLib.getDocument({ data: copy });
  const pdf = await loadingTask.promise;
  const pages = pdf.numPages;
  await loadingTask.destroy();
  return Math.max(1, pages);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function splitBase64Chunks(base64: string, chunkLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += chunkLen) {
    chunks.push(base64.slice(i, i + chunkLen));
  }
  return chunks;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { pdfjsLib };
