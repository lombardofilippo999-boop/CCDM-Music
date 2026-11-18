export type UserRole = 'admin' | 'editor' | 'viewer';

export const BAND_ID = 'main-band';
export const OWNER_BOOTSTRAP_EMAIL = 'lombardofilippo999@gmail.com';
export const HERO_IMAGE_PATH = '/src/assets/images/band_rehearsal_hero_1794987898780.jpg';
export const APP_LOGO_PATH = '/assets/aistudio/CCDM_Music_logo_184dc5dd.jpg';

export const VALIDATION_LIMITS = {
  idPattern: /^[a-zA-Z0-9_\-]+$/,
  inviteCodePattern: /^[A-Z0-9_\-]+$/,
  displayNameMin: 2,
  displayNameMax: 80,
  instrumentMax: 60,
  inviteCodeMin: 4,
  inviteCodeMax: 32,
  inviteLabelMax: 80,
  songTitleMax: 120,
  songArtistMax: 100,
  musicalKeyMax: 24,
  bpmMax: 400,
  durationMax: 16,
  genreMax: 40,
  notesMax: 1000,
  fileNameMax: 160,
  maxPdfBytes: 15 * 1024 * 1024, // 15 MB
  chunkBase64MaxLen: 500000, // ~500 KB per Firestore chunk (< 700 KB rule limit)
  maxChunks: 40,
  setlistTitleMax: 120,
  setlistVenueMax: 120,
  setlistSongsMax: 100,
} as const;

export interface BandMember {
  uid: string;
  bandId: string;
  displayName: string;
  instrument: string;
  role: UserRole;
  inviteCodeUsed: string;
  joinedAtMs: number;
  updatedAtMs: number;
}

export interface InviteCode {
  code: string;
  bandId: string;
  role: UserRole;
  label: string;
  maxUses: number;
  usedCount: number;
  active: boolean;
  createdBy: string;
  createdAtMs: number;
}

export interface BandSong {
  id: string;
  bandId: string;
  title: string;
  artist: string;
  musicalKey: string;
  bpm: number;
  duration: string;
  genre: string;
  notes: string;
  fileName: string;
  fileSizeBytes: number;
  chunkCount: number;
  pageCount: number;
  uploadedByUid: string;
  uploadedByName: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface EventSetlist {
  id: string;
  bandId: string;
  eventTitle: string;
  eventDate: string;
  venue: string;
  notes: string;
  songIds: string[];
  createdByUid: string;
  createdByName: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export type AppTab = 'songs' | 'setlists' | 'band' | 'profile';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Amministratore',
  editor: 'Editor',
  viewer: 'Visualizzatore',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Controllo totale: gestisce brani, scalette, codici invito e membri della band.',
  editor: 'Carica nuovi spartiti PDF, modifica o elimina brani e crea scalette.',
  viewer: 'Consulta i brani PDF della band e segue le scalette dal vivo.',
};
