import React, { useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Check, Copy, KeyRound, Plus, Shield, Trash2, Users } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BAND_ID,
  ROLE_LABELS,
  VALIDATION_LIMITS,
  type BandMember,
  type InviteCode,
  type UserRole,
} from '../types';

interface BandMembersViewProps {
  members: BandMember[];
  invites: InviteCode[];
  currentMember: BandMember;
}

export const BandMembersView: React.FC<BandMembersViewProps> = ({
  members,
  invites,
  currentMember,
}) => {
  const isAdmin = currentMember.role === 'admin';
  const [newRole, setNewRole] = useState<UserRole>('editor');
  const [newLabel, setNewLabel] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('5');
  const [customCode, setCustomCode] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [confirmRemoveUid, setConfirmRemoveUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const generateRandomCode = (role: UserRole) => {
    const prefix = role === 'admin' ? 'ADM' : role === 'editor' ? 'ED' : 'VW';
    const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    return `BAND-${prefix}-${rand}`;
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setErrorMsg(null);

    const code = (customCode.trim() || generateRandomCode(newRole)).toUpperCase();
    if (
      code.length < VALIDATION_LIMITS.inviteCodeMin ||
      code.length > VALIDATION_LIMITS.inviteCodeMax ||
      !VALIDATION_LIMITS.inviteCodePattern.test(code)
    ) {
      setErrorMsg('Codice non valido: usa 4–32 caratteri (A-Z, 0-9, - o _).');
      return;
    }

    const label = (newLabel.trim() || `Invito ${ROLE_LABELS[newRole]}`).slice(
      0,
      VALIDATION_LIMITS.inviteLabelMax,
    );
    const maxUses = Math.max(1, Math.min(100, Math.round(Number(newMaxUses) || 1)));

    setBusy(true);
    try {
      await setDoc(doc(db, 'invites', code), {
        code,
        bandId: BAND_ID,
        role: newRole,
        label,
        maxUses,
        usedCount: 0,
        active: true,
        createdBy: currentMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `invites/${code}`));
      setCustomCode('');
      setNewLabel('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore creazione codice invito.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleInvite = async (invite: InviteCode) => {
    if (!isAdmin) return;
    await updateDoc(doc(db, 'invites', invite.code), {
      active: !invite.active,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `invites/${invite.code}`));
  };

  const handleDeleteInvite = async (code: string) => {
    if (!isAdmin) return;
    await deleteDoc(doc(db, 'invites', code)).catch((err) =>
      handleFirestoreError(err, OperationType.DELETE, `invites/${code}`),
    );
  };

  const handleChangeMemberRole = async (member: BandMember, targetRole: UserRole) => {
    if (!isAdmin || member.role === targetRole) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', member.uid), {
        role: targetRole,
        updatedAt: serverTimestamp(),
      });
      if (targetRole === 'admin') {
        batch.set(doc(db, 'admins', member.uid), {
          uid: member.uid,
          grantedAt: serverTimestamp(),
          grantedBy: currentMember.uid,
        });
      } else {
        batch.delete(doc(db, 'admins', member.uid));
      }
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${member.uid}`));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (member: BandMember) => {
    if (!isAdmin || member.uid === currentMember.uid) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', member.uid, 'private', 'info'));
      batch.delete(doc(db, 'admins', member.uid));
      batch.delete(doc(db, 'users', member.uid));
      await batch
        .commit()
        .catch((err) => handleFirestoreError(err, OperationType.DELETE, `users/${member.uid}`));
      setConfirmRemoveUid(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1
          className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950 dark:text-zinc-50"
          style={{ textWrap: 'balance' }}
        >
          Componenti &amp; Inviti
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {isAdmin
            ? 'Gestisci i ruoli dei musicisti, genera i codici invito obbligatori per i nuovi membri (Editor, Visualizzatori o Admin) e rimuovi membri senza perdere gli spartiti.'
            : 'Elenco dei componenti della band. Solo l’amministratore può invitare o rimuovere membri.'}
        </p>
      </div>

      {/* Admin-only Invite Generator */}
      {isAdmin && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
              Genera codice invito
            </h2>
          </div>

          <form
            onSubmit={(e) => void handleCreateInvite(e)}
            className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Ruolo assegnato
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="editor">Editor (carica/modifica brani)</option>
                <option value="viewer">Visualizzatore</option>
                <option value="admin">Amministratore</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Etichetta (es. Chitarra)
              </label>
              <input
                type="text"
                maxLength={VALIDATION_LIMITS.inviteLabelMax}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Es. Sezione fiati"
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Codice (vuoto = auto)
              </label>
              <input
                type="text"
                maxLength={VALIDATION_LIMITS.inviteCodeMax}
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                placeholder="BAND-ED-..."
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-3.5 text-sm font-mono uppercase text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                Usi max
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-2.5 text-sm font-mono tabular-nums text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Crea</span>
              </button>
            </div>
          </form>

          {errorMsg && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {invites.length > 0 && (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80 pt-2">
              {invites.map((inv) => (
                <div
                  key={inv.code}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-sm font-bold text-zinc-950 dark:text-zinc-50 tracking-wider">
                        {inv.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyCode(inv.code)}
                        aria-label={`Copia codice ${inv.code}`}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {copiedCode === inv.code ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {[
                        ROLE_LABELS[inv.role],
                        inv.label,
                        `${inv.usedCount}/${inv.maxUses} utilizzi`,
                        inv.active ? 'Attivo' : 'Disattivato',
                      ].join(' · ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleInvite(inv)}
                      className="min-h-[40px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      {inv.active ? 'Disattiva' : 'Riattiva'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteInvite(inv.code)}
                      aria-label={`Elimina codice ${inv.code}`}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Band Members Roster */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#11141C] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
              Membri della Band
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {members.length} componenti
          </span>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {members.map((m) => {
            const isSelf = m.uid === currentMember.uid;
            return (
              <div
                key={m.uid}
                className="py-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5">
                    <span className="truncate">{m.displayName}</span>
                    {m.role === 'admin' && (
                      <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                    {isSelf && <span className="text-xs font-normal text-zinc-400">(Tu)</span>}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {[ROLE_LABELS[m.role], m.instrument || 'Musicista'].join(' · ')}
                  </p>
                </div>

                {isAdmin && !isSelf && (
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label={`Ruolo di ${m.displayName}`}
                      disabled={busy}
                      value={m.role}
                      onChange={(e) => void handleChangeMemberRole(m, e.target.value as UserRole)}
                      className="min-h-[40px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#090B10] px-2.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="admin">Amministratore</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Visualizzatore</option>
                    </select>

                    {confirmRemoveUid === m.uid ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRemoveMember(m)}
                          className="min-h-[40px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold whitespace-nowrap"
                        >
                          Rimuovi
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveUid(null)}
                          className="min-h-[40px] px-2.5 rounded-xl text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveUid(m.uid)}
                        aria-label={`Rimuovi ${m.displayName}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
