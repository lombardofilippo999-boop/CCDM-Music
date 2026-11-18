import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  where,
} from 'firebase/firestore';
import { ListMusic, Music2, Plus, User as UserIcon, Users, WifiOff } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { BandMembersView } from './components/BandMembersView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PdfReaderModal } from './components/PdfReaderModal';
import { ProfileView } from './components/ProfileView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SetlistView } from './components/SetlistView';
import { SongFormModal } from './components/SongFormModal';
import { SongLibraryView } from './components/SongLibraryView';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  listCachedPdfMeta,
  loadSnapshot,
  saveSnapshot,
} from './lib/offlineStorage';
import {
  APP_LOGO_PATH,
  BAND_ID,
  OWNER_BOOTSTRAP_EMAIL,
  type AppTab,
  type BandMember,
  type BandSong,
  type EventSetlist,
  type InviteCode,
} from './types';

function tsToMs(value: unknown): number {
  if (!value) return Date.now();
  if (typeof (value as Timestamp).toMillis === 'function') {
    return (value as Timestamp).toMillis();
  }
  return Date.now();
}

function BandAppShell() {
  const isOnline = useOnlineStatus();
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [memberLoading, setMemberLoading] = useState(true);
  const [currentMember, setCurrentMember] = useState<BandMember | null>(null);

  const [activeTab, setActiveTab] = useState<AppTab>('songs');
  const [songs, setSongs] = useState<BandSong[]>([]);
  const [setlists, setSetlists] = useState<EventSetlist[]>([]);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [cachedMap, setCachedMap] = useState<
    Record<string, { updatedAtMs: number; sizeBytes: number }>
  >({});

  const [songModalTarget, setSongModalTarget] = useState<BandSong | 'new' | null>(null);
  const [readerSong, setReaderSong] = useState<BandSong | null>(null);
  const [readerSetlist, setReaderSetlist] = useState<{
    setlist: EventSetlist;
    index: number;
  } | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('leggio-theme');
      if (saved === 'light') return false;
      return true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('leggio-theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage error
    }
  }, [darkMode]);

  const refreshCachedMeta = useCallback(() => {
    void listCachedPdfMeta().then(setCachedMap);
  }, []);

  useEffect(() => {
    refreshCachedMeta();
  }, [refreshCachedMeta]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setCurrentMember(null);
        setMemberLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    setMemberLoading(true);
    void loadSnapshot<BandMember>(`member_${firebaseUser.uid}`).then((cached) => {
      if (cached) setCurrentMember(cached);
    });

    const userRef = doc(db, 'users', firebaseUser.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const profile: BandMember = {
            uid: d.uid,
            bandId: d.bandId,
            displayName: d.displayName,
            instrument: d.instrument || '',
            role: d.role,
            inviteCodeUsed: d.inviteCodeUsed || '',
            joinedAtMs: tsToMs(d.joinedAt),
            updatedAtMs: tsToMs(d.updatedAt),
          };
          setCurrentMember(profile);
          void saveSnapshot(`member_${firebaseUser.uid}`, profile);
        } else {
          setCurrentMember(null);
        }
        setMemberLoading(false);
      },
      (err) => {
        setMemberLoading(false);
        handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
      },
    );

    return () => unsub();
  }, [authReady, firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || !currentMember) return;

    void loadSnapshot<BandSong[]>('songs').then((c) => {
      if (c && c.length > 0) setSongs(c);
    });
    void loadSnapshot<EventSetlist[]>('setlists').then((c) => {
      if (c && c.length > 0) setSetlists(c);
    });
    void loadSnapshot<BandMember[]>('members').then((c) => {
      if (c && c.length > 0) setMembers(c);
    });

    const songsQuery = query(
      collection(db, 'songs'),
      where('bandId', '==', BAND_ID),
      orderBy('title', 'asc'),
    );
    const unsubSongs = onSnapshot(
      songsQuery,
      (snap) => {
        const list: BandSong[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            bandId: d.bandId,
            title: d.title,
            artist: d.artist || '',
            musicalKey: d.musicalKey || '',
            bpm: Number(d.bpm) || 0,
            duration: d.duration || '',
            genre: d.genre || '',
            notes: d.notes || '',
            fileName: d.fileName,
            fileSizeBytes: Number(d.fileSizeBytes) || 0,
            chunkCount: Number(d.chunkCount) || 1,
            pageCount: Number(d.pageCount) || 1,
            uploadedByUid: d.uploadedByUid,
            uploadedByName: d.uploadedByName || 'Musicista',
            createdAtMs: tsToMs(d.createdAt),
            updatedAtMs: tsToMs(d.updatedAt),
          };
        });
        setSongs(list);
        void saveSnapshot('songs', list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'songs'),
    );

    const setlistsQuery = query(
      collection(db, 'setlists'),
      where('bandId', '==', BAND_ID),
      orderBy('eventDate', 'desc'),
    );
    const unsubSetlists = onSnapshot(
      setlistsQuery,
      (snap) => {
        const list: EventSetlist[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            bandId: d.bandId,
            eventTitle: d.eventTitle,
            eventDate: d.eventDate,
            venue: d.venue || '',
            notes: d.notes || '',
            songIds: Array.isArray(d.songIds) ? d.songIds : [],
            createdByUid: d.createdByUid,
            createdByName: d.createdByName || 'Musicista',
            createdAtMs: tsToMs(d.createdAt),
            updatedAtMs: tsToMs(d.updatedAt),
          };
        });
        setSetlists(list);
        void saveSnapshot('setlists', list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'setlists'),
    );

    const membersQuery = query(
      collection(db, 'users'),
      where('bandId', '==', BAND_ID),
      orderBy('displayName', 'asc'),
    );
    const unsubMembers = onSnapshot(
      membersQuery,
      (snap) => {
        const list: BandMember[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: d.uid,
            bandId: d.bandId,
            displayName: d.displayName,
            instrument: d.instrument || '',
            role: d.role,
            inviteCodeUsed: d.inviteCodeUsed || '',
            joinedAtMs: tsToMs(d.joinedAt),
            updatedAtMs: tsToMs(d.updatedAt),
          };
        });
        setMembers(list);
        void saveSnapshot('members', list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users'),
    );

    let unsubInvites: (() => void) | undefined;
    if (currentMember.role === 'admin') {
      const isBootstrapOwner =
        Boolean(firebaseUser.emailVerified) &&
        firebaseUser.email?.toLowerCase() === OWNER_BOOTSTRAP_EMAIL.toLowerCase();
      const invitesQuery = isBootstrapOwner
        ? query(collection(db, 'invites'), orderBy('createdAt', 'desc'))
        : query(
            collection(db, 'invites'),
            where('createdBy', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc'),
          );

      unsubInvites = onSnapshot(
        invitesQuery,
        (snap) => {
          const list: InviteCode[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              code: d.code,
              bandId: d.bandId,
              role: d.role,
              label: d.label,
              maxUses: Number(d.maxUses) || 1,
              usedCount: Number(d.usedCount) || 0,
              active: Boolean(d.active),
              createdBy: d.createdBy,
              createdAtMs: tsToMs(d.createdAt),
            };
          });
          setInvites(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'invites'),
      );
    }

    return () => {
      unsubSongs();
      unsubSetlists();
      unsubMembers();
      unsubInvites?.();
    };
  }, [firebaseUser, currentMember?.uid, currentMember?.role]);

  const setlistReaderSongs = useMemo(() => {
    if (!readerSetlist) return [];
    const byId = new Map(songs.map((s) => [s.id, s]));
    return readerSetlist.setlist.songIds
      .map((id) => byId.get(id))
      .filter((s): s is BandSong => Boolean(s));
  }, [readerSetlist, songs]);

  const activeReaderSong = useMemo(() => {
    if (readerSetlist && setlistReaderSongs.length > 0) {
      return setlistReaderSongs[readerSetlist.index] || setlistReaderSongs[0];
    }
    return readerSong;
  }, [readerSetlist, setlistReaderSongs, readerSong]);

  if (!authReady || (firebaseUser && memberLoading)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F6F8] dark:bg-[#090B10] gap-4 p-6">
        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#07031C] border border-zinc-200 dark:border-zinc-800 shadow-lg">
          <img
            src={APP_LOGO_PATH}
            alt="Logo CCDM Music"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-110"
          />
        </div>
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Caricamento leggio...</p>
      </div>
    );
  }

  if (!firebaseUser || !currentMember) {
    return (
      <AuthScreen
        firebaseUser={firebaseUser}
        needsOnboarding={Boolean(firebaseUser && !currentMember)}
        onOnboardingComplete={() => {}}
      />
    );
  }

  const canEdit = currentMember.role === 'admin' || currentMember.role === 'editor';

  const navItems: { id: AppTab; label: string; icon: typeof Music2 }[] = [
    { id: 'songs', label: 'Brani', icon: Music2 },
    { id: 'setlists', label: 'Scalette', icon: ListMusic },
    { id: 'band', label: 'Band', icon: Users },
    { id: 'profile', label: 'Profilo', icon: UserIcon },
  ];

  return (
    <div className="min-h-screen bg-[#F5F6F8] dark:bg-[#090B10] text-zinc-950 dark:text-zinc-50 flex flex-col pb-20 lg:pb-0 transition-colors">
      {/* Top Bar Contract (strictly 3 zones: Wordmark — Nav Links — 1 Primary Action) */}
      <header className="sticky top-0 z-30 h-13 lg:h-16 bg-white/85 dark:bg-[#0E1118]/85 backdrop-blur-xl border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('songs')}
            className="inline-flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap shrink-0"
          >
            <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl overflow-hidden bg-[#07031C] border border-zinc-200/80 dark:border-zinc-700/70 shrink-0">
              <img
                src={APP_LOGO_PATH}
                alt="Logo CCDM Music"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover scale-110"
              />
            </span>
            <span>CCDM Music</span>
          </button>

          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                    active
                      ? 'border-blue-600 dark:border-blue-500 text-zinc-950 dark:text-zinc-50 font-semibold'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {canEdit ? (
              <button
                type="button"
                onClick={() => setSongModalTarget('new')}
                className="min-h-[40px] px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Carica PDF
              </button>
            ) : (
              <PWAInstallButton compact />
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {!isOnline && (
          <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 flex items-center gap-2.5 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              Modalità offline attiva: puoi aprire tutti gli spartiti PDF già salvati sul dispositivo.
            </span>
          </div>
        )}

        {activeTab === 'songs' && (
          <SongLibraryView
            songs={songs}
            currentMember={currentMember}
            cachedMap={cachedMap}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
            onOpenSong={(song) => {
              setReaderSetlist(null);
              setReaderSong(song);
            }}
            onAddSong={() => setSongModalTarget('new')}
            onEditSong={(song) => setSongModalTarget(song)}
            onCacheUpdated={refreshCachedMeta}
          />
        )}

        {activeTab === 'setlists' && (
          <SetlistView
            setlists={setlists}
            songs={songs}
            currentMember={currentMember}
            cachedMap={cachedMap}
            onOpenSetlistReader={(setlist, index) => {
              setReaderSong(null);
              setReaderSetlist({ setlist, index });
            }}
            onCacheUpdated={refreshCachedMeta}
          />
        )}

        {activeTab === 'band' && (
          <BandMembersView
            members={members}
            invites={invites}
            currentMember={currentMember}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileView
            firebaseUser={firebaseUser}
            currentMember={currentMember}
            songs={songs}
            cachedMap={cachedMap}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
            onCacheUpdated={refreshCachedMeta}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#0E1118]/90 backdrop-blur-xl border-t border-zinc-200/80 dark:border-zinc-800/80 pb-safe">
        <div className="grid grid-cols-4 h-16 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {songModalTarget && (
        <SongFormModal
          existingSong={songModalTarget === 'new' ? null : songModalTarget}
          currentMember={currentMember}
          onClose={() => setSongModalTarget(null)}
          onSaved={refreshCachedMeta}
        />
      )}

      {activeReaderSong && (
        <PdfReaderModal
          song={activeReaderSong}
          onClose={() => {
            setReaderSong(null);
            setReaderSetlist(null);
          }}
          setlistContext={
            readerSetlist && setlistReaderSongs.length > 0
              ? {
                  eventTitle: readerSetlist.setlist.eventTitle,
                  songs: setlistReaderSongs,
                  currentIndex: readerSetlist.index,
                  onSelectSongIndex: (nextIdx) =>
                    setReaderSetlist((prev) => (prev ? { ...prev, index: nextIdx } : null)),
                }
              : undefined
          }
          onCachedUpdate={refreshCachedMeta}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BandAppShell />
    </ErrorBoundary>
  );
}
