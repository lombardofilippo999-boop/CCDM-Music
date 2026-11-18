import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MailCheck,
  Music2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { auth, db, FIREBASE_PROJECT_ID, handleFirestoreError, OperationType } from '../firebase';
import {
  APP_LOGO_PATH,
  BAND_ID,
  HERO_IMAGE_PATH,
  OWNER_BOOTSTRAP_EMAIL,
  VALIDATION_LIMITS,
  type InviteCode,
  type UserRole,
} from '../types';

interface AuthScreenProps {
  firebaseUser: User | null;
  needsOnboarding: boolean;
  onOnboardingComplete: () => void;
}

const PENDING_REG_KEY = 'ccdm_pending_registration';

interface PendingRegistrationDraft {
  displayName?: string;
  instrument?: string;
  inviteCode?: string;
  errorMsg?: string | null;
}

function readPendingDraft(): PendingRegistrationDraft {
  try {
    const raw = sessionStorage.getItem(PENDING_REG_KEY);
    return raw ? (JSON.parse(raw) as PendingRegistrationDraft) : {};
  } catch {
    return {};
  }
}

function writePendingDraft(draft: PendingRegistrationDraft | null) {
  try {
    if (!draft) {
      sessionStorage.removeItem(PENDING_REG_KEY);
    } else {
      sessionStorage.setItem(PENDING_REG_KEY, JSON.stringify(draft));
    }
  } catch {
    // Ignore storage error
  }
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  firebaseUser,
  needsOnboarding,
  onOnboardingComplete,
}) => {
  const initialDraft = readPendingDraft();
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Registration & Onboarding profile fields
  const [displayName, setDisplayName] = useState(
    initialDraft.displayName || firebaseUser?.displayName || '',
  );
  const [instrument, setInstrument] = useState(initialDraft.instrument || '');
  const [inviteCode, setInviteCode] = useState(initialDraft.inviteCode || '');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialDraft.errorMsg || null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [emailProviderDisabled, setEmailProviderDisabled] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [logoImgFailed, setLogoImgFailed] = useState(false);

  useEffect(() => {
    if (firebaseUser?.displayName && !displayName) {
      setDisplayName(firebaseUser.displayName);
    }
  }, [firebaseUser?.displayName, displayName]);

  const isVerifiedOwnerEmail = Boolean(
    firebaseUser?.emailVerified &&
      firebaseUser.email?.toLowerCase() === OWNER_BOOTSTRAP_EMAIL.toLowerCase(),
  );

  const isUnverifiedOwnerEmail = Boolean(
    firebaseUser &&
      !firebaseUser.emailVerified &&
      firebaseUser.email?.toLowerCase() === OWNER_BOOTSTRAP_EMAIL.toLowerCase(),
  );

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  const mapAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      setEmailProviderDisabled(true);
      return 'Il provider Email/Password non è ancora abilitato su Firebase Authentication per questo progetto.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'Esiste già un account con questa email. Passa alla scheda "Accedi" per entrare.';
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found'
    ) {
      return 'Email o password non validi.';
    }
    if (code === 'auth/invalid-email') {
      return 'Inserisci un indirizzo email valido.';
    }
    if (code === 'auth/weak-password') {
      return 'La password deve contenere almeno 6 caratteri.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Troppi tentativi ravvicinati. Attendi qualche minuto e riprova.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Finestra di accesso Google chiusa prima del completamento.';
    }
    return err instanceof Error ? err.message : 'Errore durante l’autenticazione.';
  };

  const commitBandProfile = async (
    user: User,
    rawName: string,
    rawInstrument: string,
    rawInviteCode: string,
  ): Promise<boolean> => {
    const cleanName = rawName.trim().slice(0, VALIDATION_LIMITS.displayNameMax);
    const cleanInstrument = rawInstrument.trim().slice(0, VALIDATION_LIMITS.instrumentMax);
    if (cleanName.length < VALIDATION_LIMITS.displayNameMin) {
      setErrorMsg('Inserisci il tuo nome e cognome (almeno 2 caratteri).');
      return false;
    }

    const normalizedCode = rawInviteCode.trim().toUpperCase();
    const userIsVerifiedOwner = Boolean(
      user.emailVerified && user.email?.toLowerCase() === OWNER_BOOTSTRAP_EMAIL.toLowerCase(),
    );

    let resolvedRole: UserRole = 'viewer';
    let codeToRedeem = '';
    let currentUsedCount = 0;

    if (normalizedCode.length > 0) {
      if (
        normalizedCode.length < VALIDATION_LIMITS.inviteCodeMin ||
        normalizedCode.length > VALIDATION_LIMITS.inviteCodeMax ||
        !VALIDATION_LIMITS.inviteCodePattern.test(normalizedCode)
      ) {
        setErrorMsg(
          'Codice invito non valido: usa 4–32 caratteri (solo lettere maiuscole, numeri, - o _).',
        );
        return false;
      }

      const inviteSnap = await getDoc(doc(db, 'invites', normalizedCode)).catch((err) =>
        handleFirestoreError(err, OperationType.GET, `invites/${normalizedCode}`),
      );

      if (!inviteSnap.exists()) {
        const msg = `Codice invito "${normalizedCode}" inesistente. Verifica il codice inviato dall’amministratore.`;
        writePendingDraft({
          displayName: cleanName,
          instrument: cleanInstrument,
          inviteCode: normalizedCode,
          errorMsg: msg,
        });
        setErrorMsg(msg);
        return false;
      }

      const inviteData = inviteSnap.data() as InviteCode;
      if (!inviteData.active) {
        const msg = `Il codice invito "${normalizedCode}" è stato disattivato.`;
        writePendingDraft({
          displayName: cleanName,
          instrument: cleanInstrument,
          inviteCode: normalizedCode,
          errorMsg: msg,
        });
        setErrorMsg(msg);
        return false;
      }
      if (inviteData.usedCount >= inviteData.maxUses) {
        const msg = `Il codice invito "${normalizedCode}" ha raggiunto il numero massimo di utilizzi.`;
        writePendingDraft({
          displayName: cleanName,
          instrument: cleanInstrument,
          inviteCode: normalizedCode,
          errorMsg: msg,
        });
        setErrorMsg(msg);
        return false;
      }

      resolvedRole = inviteData.role;
      codeToRedeem = normalizedCode;
      currentUsedCount = inviteData.usedCount;
    } else if (userIsVerifiedOwner) {
      resolvedRole = 'admin';
      codeToRedeem = 'OWNER_BOOTSTRAP';
    } else {
      setErrorMsg('Il codice invito è obbligatorio per registrarsi. Chiedilo all’amministratore.');
      return false;
    }

    const batch = writeBatch(db);
    const userRef = doc(db, 'users', user.uid);
    const privateRef = doc(db, 'users', user.uid, 'private', 'info');

    batch.set(userRef, {
      uid: user.uid,
      bandId: BAND_ID,
      displayName: cleanName,
      instrument: cleanInstrument,
      role: resolvedRole,
      inviteCodeUsed: codeToRedeem,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(privateRef, {
      uid: user.uid,
      email: (user.email || 'no-email@band.local').slice(0, 160),
      updatedAt: serverTimestamp(),
    });

    if (codeToRedeem && codeToRedeem !== 'OWNER_BOOTSTRAP') {
      batch.update(doc(db, 'invites', codeToRedeem), {
        usedCount: currentUsedCount + 1,
        updatedAt: serverTimestamp(),
      });
    }

    if (resolvedRole === 'admin') {
      batch.set(doc(db, 'admins', user.uid), {
        uid: user.uid,
        grantedAt: serverTimestamp(),
        grantedBy: user.uid,
      });
    }

    await batch
      .commit()
      .catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));

    writePendingDraft(null);
    onOnboardingComplete();
    return true;
  };

  const handleGoogleAuth = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setEmailProviderDisabled(false);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setEmailProviderDisabled(false);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setErrorMsg('Inserisci email e password.');
        setBusy(false);
        return;
      }

      if (authTab === 'login') {
        await signInWithEmailAndPassword(auth, trimmedEmail, password);
        return;
      }

      // Registration tab: validate profile & optional invite code syntax before creating Auth user
      const cleanName = displayName.trim().slice(0, VALIDATION_LIMITS.displayNameMax);
      if (cleanName.length < VALIDATION_LIMITS.displayNameMin) {
        setErrorMsg('Inserisci il tuo nome e cognome (almeno 2 caratteri).');
        setBusy(false);
        return;
      }

      const normalizedCode = inviteCode.trim().toUpperCase();
      if (!normalizedCode) {
        setErrorMsg('Il codice invito è obbligatorio per registrarsi.');
        setBusy(false);
        return;
      }
      if (
        normalizedCode.length < VALIDATION_LIMITS.inviteCodeMin ||
        normalizedCode.length > VALIDATION_LIMITS.inviteCodeMax ||
        !VALIDATION_LIMITS.inviteCodePattern.test(normalizedCode)
      ) {
        setErrorMsg(
          'Codice invito non valido: usa 4–32 caratteri (solo lettere maiuscole, numeri, - o _).',
        );
        setBusy(false);
        return;
      }

      writePendingDraft({
        displayName: cleanName,
        instrument: instrument.trim(),
        inviteCode: normalizedCode,
        errorMsg: null,
      });

      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});

      await commitBandProfile(cred.user, cleanName, instrument, normalizedCode);
    } catch (err) {
      writePendingDraft(null);
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg('Inserisci la tua email nel campo sopra per ricevere il link di recupero.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoMsg(
        `Abbiamo inviato un’email per reimpostare la password a ${trimmedEmail}. Controlla anche lo spam.`,
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSendOwnerVerification = async () => {
    if (!auth.currentUser) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await sendEmailVerification(auth.currentUser);
      setInfoMsg(
        'Email di verifica inviata! Dopo aver cliccato sul link ricevuto, premi "Ho verificato email".',
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (!auth.currentUser) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      if (auth.currentUser.emailVerified) {
        window.location.reload();
      } else {
        setErrorMsg('Email non ancora verificata. Controlla la tua casella o accedi con Google.');
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await commitBandProfile(firebaseUser, displayName, instrument, inviteCode);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossibile completare la registrazione.');
    } finally {
      setBusy(false);
    }
  };

  // Onboarding / Invite code step for signed-in users without a band profile yet
  // (e.g. Google Sign-In users or Email/Password users fixing an invite code typo)
  if (firebaseUser && needsOnboarding) {
    const normalizedInvitePreview = inviteCode.trim().toUpperCase();
    return (
      <div className="min-h-screen bg-[#F5F6F8] dark:bg-[#090B10] flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
        <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-[#11141C] border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 space-y-6 my-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-14 h-14 rounded-2xl overflow-hidden bg-[#07031C] border border-zinc-200 dark:border-zinc-700/80 flex items-center justify-center shrink-0 shadow-md">
                {!logoImgFailed ? (
                  <img
                    src={APP_LOGO_PATH}
                    alt="Logo CCDM Music"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoImgFailed(true)}
                    className="w-full h-full object-cover scale-110"
                  />
                ) : (
                  <Music2 className="w-6 h-6 text-blue-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  CCDM Music · Profilo band
                </p>
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50 mt-0.5">
                  Completa la registrazione
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                  {firebaseUser.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                writePendingDraft(null);
                void signOut(auth);
              }}
              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Esci</span>
            </button>
          </div>

          <form onSubmit={(e) => void handleCompleteOnboarding(e)} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                  Nome e Cognome
                </label>
                <input
                  type="text"
                  required
                  maxLength={VALIDATION_LIMITS.displayNameMax}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Es. Marco Rossi"
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                  Strumento / Ruolo musicale
                </label>
                <input
                  type="text"
                  maxLength={VALIDATION_LIMITS.instrumentMax}
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  placeholder="Es. Chitarra, Voce, Basso"
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-1.5">
                Codice Invito{' '}
                {isVerifiedOwnerEmail ? '(non richiesto per il proprietario)' : '(obbligatorio)'}
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required={!isVerifiedOwnerEmail}
                  maxLength={VALIDATION_LIMITS.inviteCodeMax}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Es. BAND-ED-84K2"
                  className="w-full min-h-[46px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] pl-10 pr-4 text-sm font-mono uppercase tracking-wider text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                {isVerifiedOwnerEmail && !normalizedInvitePreview
                  ? 'Email proprietario riconosciuta: accederai direttamente come Amministratore principale.'
                  : 'Il codice invito è obbligatorio e attiva automaticamente il ruolo assegnato dall’amministratore (Editor, Amministratore o Visualizzatore).'}
              </p>
            </div>

            {isVerifiedOwnerEmail && !normalizedInvitePreview && (
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 px-4 py-3 text-xs text-blue-900 dark:text-blue-200 flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>
                  Email proprietario verificata: accederai direttamente come Amministratore principale.
                </span>
              </div>
            )}

            {isUnverifiedOwnerEmail && !normalizedInvitePreview && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-4 py-3.5 space-y-2.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-start gap-2.5">
                  <MailCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Stai usando l&apos;email del proprietario non ancora verificata. Per attivare il
                    ruolo di <strong>Amministratore principale</strong> senza codice invito,
                    verifica l&apos;email oppure accedi con Google (in alternativa inserisci un
                    codice invito).
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSendOwnerVerification()}
                    className="min-h-[36px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                  >
                    Invia email di verifica
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRefreshVerification()}
                    className="min-h-[36px] px-3 rounded-lg border border-amber-400 dark:border-amber-700 font-medium inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Ho verificato email</span>
                  </button>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                {infoMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>{busy ? 'Attivazione in corso...' : 'Entra in CCDM Music'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Initial Login / Registration Screen
  return (
    <div className="min-h-screen bg-[#F5F6F8] dark:bg-[#090B10] flex flex-col lg:grid lg:grid-cols-12">
      {/* Left Hero Column (Desktop full height, Mobile compact banner) */}
      <div className="relative lg:col-span-6 xl:col-span-7 min-h-[210px] sm:min-h-[260px] lg:min-h-screen bg-[#090B10] overflow-hidden flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        {!heroImgFailed ? (
          <img
            src={HERO_IMAGE_PATH}
            alt="Spartito musicale su leggio in sala prove"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-85"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#090B10] via-[#11141C] to-blue-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#090B10]/95 via-[#090B10]/60 to-[#090B10]/40" />

        <div className="relative z-10 flex items-center gap-3 text-white">
          <div className="w-12 h-12 rounded-2xl overflow-hidden bg-[#07031C] border border-white/15 shadow-lg flex items-center justify-center shrink-0">
            {!logoImgFailed ? (
              <img
                src={APP_LOGO_PATH}
                alt="Logo CCDM Music"
                referrerPolicy="no-referrer"
                onError={() => setLogoImgFailed(true)}
                className="w-full h-full object-cover scale-110"
              />
            ) : (
              <Music2 className="w-6 h-6 text-white" />
            )}
          </div>
          <span className="font-display text-xl font-extrabold tracking-tight whitespace-nowrap">
            CCDM Music
          </span>
        </div>

        <div className="relative z-10 max-w-xl mt-8 lg:mt-0 space-y-3">
          <h1
            className="font-display text-2xl sm:text-4xl xl:text-5xl font-extrabold text-white leading-tight tracking-tight"
            style={{ textWrap: 'balance' }}
          >
            Tutti gli spartiti della band, pronti sul leggio anche offline.
          </h1>
          <p className="text-sm sm:text-base text-zinc-200 leading-relaxed max-w-lg">
            Archivio PDF sincronizzato, ricerca immediata in sala prove, scalette per ogni serata
            e accesso protetto per amministratore, editor e visualizzatori.
          </p>
        </div>
      </div>

      {/* Right Auth Column */}
      <div className="flex-1 lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-white dark:bg-[#090B10] overflow-y-auto">
        <div className="w-full max-w-md space-y-5 my-auto">
          <div className="flex flex-col items-center text-center space-y-2.5">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl overflow-hidden bg-[#07031C] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-blue-950/15 flex items-center justify-center">
              {!logoImgFailed ? (
                <img
                  src={APP_LOGO_PATH}
                  alt="Logo CCDM Music"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgFailed(true)}
                  className="w-full h-full object-cover scale-110"
                />
              ) : (
                <Music2 className="w-10 h-10 text-blue-500" />
              )}
            </div>
            <div>
              <h2 className="font-display text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50">
                {authTab === 'login' ? 'Bentornato in sala prove' : 'Crea il tuo account'}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {authTab === 'login'
                  ? 'Accedi con email e password oppure con Google.'
                  : 'Registrati con email, password e il codice invito ricevuto dall’amministratore.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-[#11141C] border border-zinc-200/70 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setAuthTab('login');
                setErrorMsg(null);
                setInfoMsg(null);
                setEmailProviderDisabled(false);
              }}
              className={`min-h-[42px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                authTab === 'login'
                  ? 'bg-white dark:bg-blue-600 text-zinc-950 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              Accedi
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('register');
                setErrorMsg(null);
                setInfoMsg(null);
                setEmailProviderDisabled(false);
              }}
              className={`min-h-[42px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                authTab === 'register'
                  ? 'bg-white dark:bg-blue-600 text-zinc-950 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              Registrati
            </button>
          </div>

          <form onSubmit={(e) => void handleEmailAuth(e)} className="space-y-3.5">
            {authTab === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Nome e Cognome
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.displayNameMax}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Es. Marco Rossi"
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Strumento
                  </label>
                  <input
                    type="text"
                    maxLength={VALIDATION_LIMITS.instrumentMax}
                    value={instrument}
                    onChange={(e) => setInstrument(e.target.value)}
                    placeholder="Es. Chitarra, Voce"
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@band.it"
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Password
                </label>
                {authTab === 'login' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handlePasswordReset()}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Password dimenticata?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={authTab === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimo 6 caratteri"
                  className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] pl-3.5 pr-11 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authTab === 'register' && (
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Codice Invito (obbligatorio)
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.inviteCodeMax}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="Es. BAND-ED-84K2"
                    className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] pl-10 pr-3.5 text-sm font-mono uppercase tracking-wider text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  Inserisci il codice ricevuto dall&apos;amministratore per completare la
                  registrazione e attivare il tuo ruolo.
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-xs sm:text-sm text-red-700 dark:text-red-300 leading-relaxed space-y-2">
                <p>{errorMsg}</p>
                {emailProviderDisabled && (
                  <div className="pt-1 border-t border-red-200/70 dark:border-red-900/70 text-xs space-y-1.5">
                    <p className="font-semibold">Come abilitarlo (solo 1 volta per l&apos;Admin):</p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Apri Firebase Console &rarr; Authentication &rarr; Sign-in method</li>
                      <li>Seleziona &quot;Email/Password&quot;, attiva lo switch e salva.</li>
                    </ol>
                    <a
                      href={firebaseProvidersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-200 underline pt-0.5"
                    >
                      <span>Apri Firebase Console ({FIREBASE_PROJECT_ID})</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {infoMsg && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-4 py-3 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 leading-relaxed">
                {infoMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {busy
                ? 'Attendere...'
                : authTab === 'login'
                  ? 'Accedi con Email e Password'
                  : 'Registrati con Email e Password'}
            </button>
          </form>

          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
            <span className="shrink mx-3 text-xs text-zinc-400">oppure</span>
            <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGoogleAuth()}
            className="w-full min-h-[48px] rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-[#11141C] hover:bg-zinc-50 dark:hover:bg-zinc-800/80 text-zinc-950 dark:text-zinc-50 text-sm font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>{authTab === 'login' ? 'Accedi con Google' : 'Registrati con Google'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
