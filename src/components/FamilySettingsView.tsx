import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  Download,
  KeyRound,
  RefreshCw,
  Shield,
  ShieldCheck,
  Upload,
  UserMinus,
  Users,
} from 'lucide-react';
import { translateAuthError, useAuth } from '../contexts/AuthContext';
import { useFinance } from '../contexts/FinanceContext';
import { FamilyMember, FamilyRole, ROLE_LABELS } from '../types/finance';
import {
  FamilyBackupData,
  MAX_BACKUP_FILE_BYTES,
  downloadFamilyBackupJSON,
  parseAndValidateBackupJSON,
} from '../utils/exportReports';
import { ConfirmDialog } from './ConfirmDialog';

interface FamilySettingsViewProps {
  onNotify: (msg: string) => void;
}

type SensitiveAction =
  | { type: 'regenerate_code' }
  | { type: 'remove_member'; member: FamilyMember }
  | { type: 'restore_backup'; data: FamilyBackupData };

export function FamilySettingsView({ onNotify }: FamilySettingsViewProps) {
  const {
    user,
    profile,
    family,
    members,
    changeUserPassword,
    updateMyProfile,
    updateFamilyName,
    regenerateInviteCode,
    removeFamilyMember,
    signOut,
  } = useAuth();
  const { incomes, expenses, fixedBills, debts, reserves, budgets, restoreBackup } =
    useFinance();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [role, setRole] = useState<FamilyRole>(profile?.role || 'marido');
  const [famName, setFamName] = useState(family?.name || '');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  // Reauthentication modal state for sensitive operations
  const [pendingAction, setPendingAction] = useState<SensitiveAction | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState<FamilyMember | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = family?.ownerId === user?.uid;

  const inviteUrl =
    typeof window !== 'undefined' && family?.inviteCode
      ? `${window.location.origin}/?convite=${family.inviteCode}`
      : '';

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setErrorMsg('');
    setBusy(true);
    try {
      await updateMyProfile({ displayName: displayName.trim(), role });
      if (famName.trim() && famName.trim() !== family?.name) {
        await updateFamilyName(famName.trim());
      }
      onNotify('Dados do perfil e da família atualizados.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao atualizar perfil.');
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setPasswordMsg('');
    if (newPassword.length < 8) {
      setErrorMsg('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('A confirmação da nova senha não confere.');
      return;
    }
    setBusy(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg('Senha atualizada com sucesso após confirmação de identidade.');
    } catch (err) {
      setErrorMsg(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExportBackup = () => {
    const payload: FamilyBackupData = {
      app: 'Blessed Finance',
      version: 1,
      exportedAt: new Date().toISOString(),
      familyName: family?.name || 'Minha Família',
      incomes: incomes as unknown as Record<string, unknown>[],
      expenses: expenses as unknown as Record<string, unknown>[],
      fixedBills: fixedBills as unknown as Record<string, unknown>[],
      debts: debts as unknown as Record<string, unknown>[],
      reserves: reserves as unknown as Record<string, unknown>[],
      budgets: budgets as unknown as Record<string, unknown>[],
    };
    downloadFamilyBackupJSON(payload);
    onNotify('Backup completo exportado em JSON.');
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');

    if (!file.name.toLowerCase().endsWith('.json')) {
      setErrorMsg('Selecione apenas arquivos no formato .json.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setErrorMsg('O arquivo selecionado ultrapassa o limite de 2 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      const text = await file.text();
      const validated = parseAndValidateBackupJSON(text);
      setReauthPassword('');
      setPendingAction({ type: 'restore_backup', data: validated });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Não foi possível validar o arquivo de backup.'
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const executeSensitiveAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingAction) return;
    setErrorMsg('');
    setBusy(true);
    try {
      if (pendingAction.type === 'regenerate_code') {
        const code = await regenerateInviteCode(reauthPassword);
        onNotify(`Novo código de convite gerado: ${code}`);
      } else if (pendingAction.type === 'remove_member') {
        await removeFamilyMember(pendingAction.member.uid, reauthPassword);
        onNotify(
          `Acesso de ${pendingAction.member.displayName} revogado imediatamente.`
        );
      } else if (pendingAction.type === 'restore_backup') {
        const count = await restoreBackup(pendingAction.data, reauthPassword);
        onNotify(
          count > 0
            ? `Backup restaurado com segurança: ${count} registro(s).`
            : 'Nenhum registro novo precisou ser restaurado.'
        );
      }
      setPendingAction(null);
      setReauthPassword('');
    } catch (err) {
      setErrorMsg(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Família e Segurança</h1>
          <p className="text-sm text-slate-600">
            Gerencie integrantes, proteção da conta local, senha e backup em JSON.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer self-start"
        >
          Encerrar sessão com segurança
        </button>
      </div>

      {errorMsg && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invite Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Compartilhamento com Marido e Esposa
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Somente integrantes autorizados acessam os dados desta família no banco local. Você
                pode renovar o código ou revogar um acesso a qualquer momento.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Código de convite ativo</p>
                <p className="text-xl font-bold font-mono text-[#0D3B2E]">
                  {family?.inviteCode || '—'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(family?.inviteCode || '');
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedCode ? 'Copiado' : 'Copiar código'}
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setReauthPassword('');
                      setPendingAction({ type: 'regenerate_code' });
                    }}
                    title="Gerar novo código (exige senha)"
                    className="p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2500);
              }}
              className="w-full py-2 px-3 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold hover:bg-[#14533F] cursor-pointer flex items-center justify-center gap-2"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedLink ? 'Link copiado para enviar!' : 'Copiar link direto de convite'}
            </button>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Integrantes conectados ({members.length})
            </h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {members.map((m) => (
                <div
                  key={m.uid}
                  className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {m.displayName}{' '}
                      {m.uid === user?.uid && (
                        <span className="text-xs text-slate-500">(Você)</span>
                      )}
                      {m.uid === family?.ownerId && (
                        <span className="text-xs text-[#9A7B2C]"> · Administrador</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#0D3B2E]">
                      {ROLE_LABELS[m.role] || 'Familiar'}
                    </span>
                    {isOwner && m.uid !== user?.uid && (
                      <button
                        type="button"
                        onClick={() => setRemoveConfirm(m)}
                        title="Revogar acesso deste integrante"
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Profile & Family Name Form */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-bold text-slate-900">Seu perfil e nome da família</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nome da família
              </label>
              <input
                type="text"
                required
                value={famName}
                onChange={(e) => setFamName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Seu nome</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Perfil familiar
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['marido', 'esposa', 'familiar'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border cursor-pointer ${
                      role === r
                        ? 'bg-[#0D3B2E] text-white border-[#0D3B2E]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                E-mail da conta
              </label>
              <input
                type="text"
                disabled
                value={user?.email || ''}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-500"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>
        </section>
      </div>

      {/* Security Controls & Password Change */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#0D3B2E] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Banco Local e Proteção da Sessão
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Armazenamento SQLite dentro do próprio projeto Node.js, sem credenciais externas.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs sm:text-sm">
            <div className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-600 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#0D3B2E]" />
                Banco de dados
              </span>
              <span className="font-semibold text-[#15803D]">SQLite local (no projeto)</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-600">Proteção de senhas</span>
              <span className="font-semibold text-[#15803D]">Hash scrypt com salt no servidor</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-600">Bloqueio automático por inatividade</span>
              <span className="font-semibold text-slate-900">30 minutos</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-slate-600">Reautenticação em ações sensíveis</span>
              <span className="font-semibold text-[#15803D]">Ativa por senha</span>
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Alterar senha</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Exige validação da senha atual antes de aplicar a nova senha.
              </p>
            </div>
          </div>

          {passwordMsg && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {passwordMsg}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-3">
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Senha atual"
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nova senha (mín. 8 caracteres)"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300"
              />
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmar nova senha"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#0D3B2E] text-white text-xs sm:text-sm font-semibold hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
            >
              Atualizar senha
            </button>
          </form>
        </section>
      </div>

      {/* Backup & Recovery */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#FEF9EC] text-[#9A7B2C] flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Backup e Recuperação de Dados
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Os arquivos de restauração passam por validação rigorosa de tamanho (máx. 2 MB),
              formato e sanitização, exigindo confirmação de senha antes de gravar no banco local.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-xs sm:text-sm font-semibold hover:bg-[#14533F] cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Baixar backup completo (JSON)
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleRestoreFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold hover:bg-slate-50 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Restaurar de arquivo JSON
          </button>
        </div>
      </section>

      {/* Reauthentication Modal */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Confirme sua identidade</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Esta operação sensível exige confirmação da sua senha atual para proteger os dados
              financeiros da família.
            </p>
            <form onSubmit={executeSensitiveAction} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sua senha atual
                </label>
                <input
                  type="password"
                  required
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingAction(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#0D3B2E] rounded-lg hover:bg-[#14533F] cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Verificando...' : 'Confirmar e prosseguir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Member Revocation */}
      <ConfirmDialog
        open={Boolean(removeConfirm)}
        title="Revogar acesso de integrante"
        description={`Ao remover ${removeConfirm?.displayName}, esta pessoa perderá imediatamente o acesso aos dados financeiros da família. Será solicitada sua senha para confirmar.`}
        confirmLabel="Continuar para verificação"
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          if (!removeConfirm) return;
          const target = removeConfirm;
          setRemoveConfirm(null);
          setReauthPassword('');
          setPendingAction({ type: 'remove_member', member: target });
        }}
      />
    </div>
  );
}
