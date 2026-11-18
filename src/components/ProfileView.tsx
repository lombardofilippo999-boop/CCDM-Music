import React, { useState } from 'react';
import {
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  DownloadCloud,
  HardDrive,
  KeyRound,
  LogOut,
  Moon,
  Sun,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { clearAllCachedPdfs, formatBytes } from '../lib/offlineStorage';
import { fetchAndCacheSongPdf } from '../lib/songSync';
import { ROLE_LABELS, VALIDATION_LIMITS, type BandMember, type BandSong } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileViewProps {
  firebaseUser: User;
  currentMember: BandMember;
  songs: BandSong[];
  cachedMap: Record<string, { updatedAtMs: number; sizeBytes: number }>;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onCacheUpdated: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  firebaseUser,
  currentMember,
  songs,
  cachedMap,
  darkMode,
  onToggleDarkMode,
  onCacheUpdated,
}) => {
  const [displayName, setDisplayName] = useState(currentMember.displayName);
  const [instrument, setInstrument] = useState(currentMember.instrument);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [busy, setBusy] = useState(false);

  const hasPasswordProvider = firebaseUser.providerData.some((p) => p.providerId === 'password');

  const totalCachedBytes = Object.values(cachedMap).reduce((sum, item) => sum + item.sizeBytes, 0);
  const cachedCount = Object.keys(cachedMap).length;

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileErr(null);

    const cleanName = displayName.trim().slice(0, VALIDATION_LIMITS.displayNameMax);
    if (cleanName.length < VALIDATION_LIMITS.displayNameMin) {
      setProfileErr('Il nome deve avere almeno 2 caratteri.');
      return;
    }

    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', currentMember.uid), {
        displayName: cleanName,
        instrument: instrument.trim().slice(0, VALIDATION_LIMITS.instrumentMax),
        updatedAt: serverTimestamp(),
      });
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${currentMember.uid}`));
      setProfileMsg('Profilo aggiornato con successo.');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Errore durante aggiornamento profilo.');
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    setPwdErr(null);

    if (newPassword.length < 6) {
      setPwdErr('La nuova password deve contenere almeno 6 caratteri.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwdErr('Le due nuove password non coincidono.');
      return;
    }
    if (!firebaseUser.email) {
      setPwdErr('Nessuna email associata a questo account.');
      return;
    }

    setBusy(true);
    try {
      if (hasPasswordProvider) {
        if (!currentPassword) {
          setPwdErr('Inserisci la tua password attuale per confermare.');
          setBusy(false);
          return;
        }
        const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, credential);
      } else {
        await reauthenticateWithPopup(firebaseUser, new GoogleAuthProvider());
      }

      await updatePassword(firebaseUser, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPwdMsg('Password aggiornata correttamente.');
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPwdErr('La password attuale non è corretta.');
      } else if (code === 'auth/operation-not-allowed') {
        setPwdErr(
          'Il provider Email/Password non è attivo in Firebase Console per questo progetto.',
        );
      } else {
        setPwdErr(err instanceof Error ? err.message : 'Impossibile cambiare la password.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadAllOffline = async () => {
    if (songs.length === 0) return;
    setDownloadingAll(true);
    let done = 0;
    try {
      for (const song of songs) {
        done++;
        setDownloadProgress(`${done}/${songs.length}`);
        await fetchAndCacheSongPdf(song);
      }
      onCacheUpdated();
    } finally {
      setDownloadingAll(false);
      setDownloadProgress('');
    }
  };

  const handleClearCache = async () => {
    await clearAllCachedPdfs();
    onCacheUpdated();
  };

  const handleDeleteOwnAccount = async () => {
    setDeleteErr(null);
    setBusy(true);
    try {
      if (hasPasswordProvider && firebaseUser.email) {
        if (!deletePassword) {
          setDeleteErr('Inserisci la password attuale per confermare l’eliminazione.');
          setBusy(false);
          return;
        }
        const cred = EmailAuthProvider.credential(firebaseUser.email, deletePassword);
        await reauthenticateWithCredential(firebaseUser, cred);
      } else {
        await reauthenticateWithPopup(firebaseUser, new GoogleAuthProvider());
      }

      // IMPORTANT: Only delete user profile/admin docs; NEVER delete songs or setlists!
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', currentMember.uid, 'private', 'info'));
      batch.delete(doc(db, 'admins', currentMember.uid));
      batch.delete(doc(db, 'users', currentMember.uid));
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.DELETE, `users/${currentMember.uid}`));

      await deleteUser(firebaseUser);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setDeleteErr('Password non corretta.');
      } else if (code === 'auth/requires-recent-login') {
        setDeleteErr(
          'Per sicurezza è richiesta una nuova autenticazione prima di eliminare l’account.',
        );
      } else {
        setDeleteErr(err instanceof Error ? err.message : 'Impossibile eliminare l’account.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1
            className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50"
            style={{ textWrap: 'balance' }}
          >
            Area Personale
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {[currentMember.displayName, ROLE_LABELS[currentMember.role], firebaseUser.email]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
          >
            {darkMode ? <Sun className="w-4 h-4 text-blue-500" /> : <Moon className="w-4 h-4 text-blue-600" />}
            <span>{darkMode ? 'Tema Chiaro' : 'Modalità Palco Scura'}</span>
          </button>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] text-xs font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Esci</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Info */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <UserCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
              Dati musicista
            </h2>
          </div>

          <form onSubmit={(e) => void handleUpdateProfile(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Nome e Cognome
              </label>
              <input
                type="text"
                required
                maxLength={VALIDATION_LIMITS.displayNameMax}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Strumento
              </label>
              <input
                type="text"
                maxLength={VALIDATION_LIMITS.instrumentMax}
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Es. Chitarra, Basso, Voce"
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {profileErr && <p className="text-xs text-red-600 dark:text-red-400">{profileErr}</p>}
            {profileMsg && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{profileMsg}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              Salva profilo
            </button>
          </form>
        </section>

        {/* Change Password */}
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
              Modifica password
            </h2>
          </div>

          <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-3.5">
            {hasPasswordProvider ? (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                  Password attuale
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Account collegato a Google: puoi comunque impostare una password personale previa
                conferma con Google.
              </p>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Nuova password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimo 6 caratteri"
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Conferma nuova password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {pwdErr && <p className="text-xs text-red-600 dark:text-red-400">{pwdErr}</p>}
            {pwdMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{pwdMsg}</p>}

            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              Aggiorna password
            </button>
          </form>
        </section>
      </div>

      {/* Offline Storage & PWA Install */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
                Archivio PDF Offline
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                {cachedCount}/{songs.length} brani salvati sul dispositivo ·{' '}
                {formatBytes(totalCachedBytes)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={downloadingAll || songs.length === 0}
              onClick={() => void handleDownloadAllOffline()}
              className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <DownloadCloud className="w-4 h-4" />
              <span>
                {downloadingAll
                  ? `Scaricamento (${downloadProgress})...`
                  : 'Scarica tutti offline'}
              </span>
            </button>
            {cachedCount > 0 && (
              <button
                type="button"
                onClick={() => void handleClearCache()}
                className="min-h-[44px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
              >
                Svuota cache locale
              </button>
            )}
          </div>
        </div>

        <PWAInstallButton />
      </section>

      {/* Delete Account Section (Preserves Uploaded Songs!) */}
      <section className="rounded-2xl border border-red-200 dark:border-red-900/70 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-3">
        <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
          <Trash2 className="w-5 h-5 shrink-0" />
          <h2 className="font-display text-lg font-bold">Elimina il mio account</h2>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Puoi eliminare il tuo accesso personale in qualsiasi momento. Tutti gli spartiti PDF e le
          scalette che hai caricato <strong>rimarranno intatti</strong> nella libreria della band.
        </p>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="min-h-[44px] px-4 rounded-xl border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            Elimina account personale
          </button>
        ) : (
          <div className="space-y-3 pt-2 max-w-md">
            {hasPasswordProvider && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                  Conferma con la tua password attuale
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Password attuale"
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            {deleteErr && <p className="text-xs text-red-600 dark:text-red-400">{deleteErr}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteOwnAccount()}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Eliminazione...' : 'Conferma eliminazione account'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteErr(null);
                }}
                className="min-h-[44px] px-3.5 rounded-xl text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
