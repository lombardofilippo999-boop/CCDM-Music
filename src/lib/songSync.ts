import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BAND_ID, VALIDATION_LIMITS, type BandSong } from '../types';
import {
  base64ToUint8,
  deleteCachedPdf,
  getCachedPdf,
  getPdfPageCount,
  saveCachedPdf,
  splitBase64Chunks,
  uint8ToBase64,
} from './offlineStorage';

export interface SaveSongInput {
  existingSong?: BandSong;
  title: string;
  artist: string;
  musicalKey: string;
  bpm: number;
  duration: string;
  genre: string;
  notes: string;
  pdfFile?: File | null;
  uploaderUid: string;
  uploaderName: string;
}

function generateId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

export async function saveSongWithPdf(input: SaveSongInput): Promise<string> {
  const isEdit = Boolean(input.existingSong);
  const songId = input.existingSong?.id ?? generateId('song');
  const title = input.title.trim().slice(0, VALIDATION_LIMITS.songTitleMax);
  const artist = input.artist.trim().slice(0, VALIDATION_LIMITS.songArtistMax);
  const musicalKey = input.musicalKey.trim().slice(0, VALIDATION_LIMITS.musicalKeyMax);
  const bpm = Math.max(0, Math.min(VALIDATION_LIMITS.bpmMax, Math.round(Number(input.bpm) || 0)));
  const duration = input.duration.trim().slice(0, VALIDATION_LIMITS.durationMax);
  const genre = input.genre.trim().slice(0, VALIDATION_LIMITS.genreMax);
  const notes = input.notes.trim().slice(0, VALIDATION_LIMITS.notesMax);

  let fileName = input.existingSong?.fileName ?? '';
  let fileSizeBytes = input.existingSong?.fileSizeBytes ?? 0;
  let chunkCount = input.existingSong?.chunkCount ?? 0;
  let pageCount = input.existingSong?.pageCount ?? 1;
  let pdfBytes: Uint8Array | null = null;
  let base64Chunks: string[] = [];

  if (input.pdfFile) {
    const buffer = await input.pdfFile.arrayBuffer();
    pdfBytes = new Uint8Array(buffer);
    if (pdfBytes.byteLength === 0 || pdfBytes.byteLength > VALIDATION_LIMITS.maxPdfBytes) {
      throw new Error('Il file PDF deve essere inferiore a 15 MB.');
    }
    fileName = input.pdfFile.name.slice(0, VALIDATION_LIMITS.fileNameMax) || 'spartito.pdf';
    fileSizeBytes = pdfBytes.byteLength;
    pageCount = await getPdfPageCount(pdfBytes);
    const base64 = uint8ToBase64(pdfBytes);
    base64Chunks = splitBase64Chunks(base64, VALIDATION_LIMITS.chunkBase64MaxLen);
    if (base64Chunks.length > VALIDATION_LIMITS.maxChunks) {
      throw new Error('Il PDF supera il numero massimo di blocchi supportati.');
    }
    chunkCount = base64Chunks.length;
  } else if (!isEdit) {
    throw new Error('Seleziona un file PDF valido.');
  }

  // If editing with a replacement PDF, remove old chunks first
  if (isEdit && input.pdfFile && input.existingSong) {
    const oldChunksRef = collection(db, 'songs', songId, 'chunks');
    const oldSnap = await getDocs(
      query(oldChunksRef, where('bandId', '==', BAND_ID)),
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `songs/${songId}/chunks`));

    const delBatch = writeBatch(db);
    oldSnap.docs.forEach((d) => delBatch.delete(d.ref));
    if (oldSnap.docs.length > 0) {
      await delBatch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.DELETE, `songs/${songId}/chunks`));
    }
  }

  const songRef = doc(db, 'songs', songId);

  if (!isEdit) {
    const firstBatchSize = Math.min(6, base64Chunks.length);
    const batch1 = writeBatch(db);
    batch1.set(songRef, {
      id: songId,
      bandId: BAND_ID,
      title,
      artist,
      musicalKey,
      bpm,
      duration,
      genre,
      notes,
      fileName,
      fileSizeBytes,
      chunkCount,
      pageCount,
      uploadedByUid: input.uploaderUid,
      uploadedByName: input.uploaderName.slice(0, VALIDATION_LIMITS.displayNameMax) || 'Musicista',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (let i = 0; i < firstBatchSize; i++) {
      const chunkRef = doc(db, 'songs', songId, 'chunks', `chunk_${String(i).padStart(3, '0')}`);
      batch1.set(chunkRef, {
        songId,
        bandId: BAND_ID,
        index: i,
        dataBase64: base64Chunks[i],
      });
    }
    await batch1
      .commit()
      .catch((err) => handleFirestoreError(err, OperationType.CREATE, `songs/${songId}`));

    for (let offset = firstBatchSize; offset < base64Chunks.length; offset += 6) {
      const batchN = writeBatch(db);
      const end = Math.min(offset + 6, base64Chunks.length);
      for (let i = offset; i < end; i++) {
        const chunkRef = doc(db, 'songs', songId, 'chunks', `chunk_${String(i).padStart(3, '0')}`);
        batchN.set(chunkRef, {
          songId,
          bandId: BAND_ID,
          index: i,
          dataBase64: base64Chunks[i],
        });
      }
      await batchN
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.CREATE, `songs/${songId}/chunks`));
    }
  } else {
    const batch = writeBatch(db);
    batch.update(songRef, {
      title,
      artist,
      musicalKey,
      bpm,
      duration,
      genre,
      notes,
      fileName,
      fileSizeBytes,
      chunkCount,
      pageCount,
      updatedAt: serverTimestamp(),
    });

    if (input.pdfFile) {
      const firstBatchSize = Math.min(6, base64Chunks.length);
      for (let i = 0; i < firstBatchSize; i++) {
        const chunkRef = doc(db, 'songs', songId, 'chunks', `chunk_${String(i).padStart(3, '0')}`);
        batch.set(chunkRef, {
          songId,
          bandId: BAND_ID,
          index: i,
          dataBase64: base64Chunks[i],
        });
      }
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `songs/${songId}`));

      for (let offset = firstBatchSize; offset < base64Chunks.length; offset += 6) {
        const batchN = writeBatch(db);
        const end = Math.min(offset + 6, base64Chunks.length);
        for (let i = offset; i < end; i++) {
          const chunkRef = doc(db, 'songs', songId, 'chunks', `chunk_${String(i).padStart(3, '0')}`);
          batchN.set(chunkRef, {
            songId,
            bandId: BAND_ID,
            index: i,
            dataBase64: base64Chunks[i],
          });
        }
        await batchN
          .commit()
          .catch((err) => handleFirestoreError(err, OperationType.CREATE, `songs/${songId}/chunks`));
      }
    } else {
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `songs/${songId}`));
    }
  }

  if (pdfBytes) {
    await saveCachedPdf(songId, Date.now(), fileName, pdfBytes);
  }

  return songId;
}

export async function deleteSongAndChunks(songId: string): Promise<void> {
  const chunksRef = collection(db, 'songs', songId, 'chunks');
  const snap = await getDocs(
    query(chunksRef, where('bandId', '==', BAND_ID)),
  ).catch((err) => handleFirestoreError(err, OperationType.LIST, `songs/${songId}/chunks`));

  for (let i = 0; i < snap.docs.length; i += 20) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 20).forEach((d) => batch.delete(d.ref));
    await batch
      .commit()
      .catch((err) => handleFirestoreError(err, OperationType.DELETE, `songs/${songId}/chunks`));
  }

  await deleteDoc(doc(db, 'songs', songId)).catch((err) =>
    handleFirestoreError(err, OperationType.DELETE, `songs/${songId}`),
  );
  await deleteCachedPdf(songId);
}

export async function fetchAndCacheSongPdf(song: BandSong): Promise<Uint8Array> {
  const cached = await getCachedPdf(song.id, song.updatedAtMs);
  if (cached) {
    return cached;
  }

  const chunksQuery = query(
    collection(db, 'songs', song.id, 'chunks'),
    where('bandId', '==', BAND_ID),
    orderBy('index', 'asc'),
  );
  const snap = await getDocs(chunksQuery).catch((err) =>
    handleFirestoreError(err, OperationType.LIST, `songs/${song.id}/chunks`),
  );

  if (snap.empty) {
    throw new Error('Spartito PDF non disponibile (nessun blocco trovato).');
  }

  const ordered = snap.docs
    .map((d) => d.data() as { index: number; dataBase64: string })
    .sort((a, b) => a.index - b.index);

  const combinedBase64 = ordered.map((c) => c.dataBase64).join('');
  const bytes = base64ToUint8(combinedBase64);
  await saveCachedPdf(song.id, song.updatedAtMs || Date.now(), song.fileName, bytes);
  return bytes;
}
