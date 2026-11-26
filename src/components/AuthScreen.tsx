import React, { useState } from 'react';
import { ArrowRight, Database, KeyRound, ShieldCheck } from 'lucide-react';
import { translateAuthError, useAuth } from '../contexts/AuthContext';
import { FamilyRole } from '../types/finance';

type AuthMode = 'login' | 'register' | 'reset';

export function AuthScreen() {
  const {
    pendingInviteCode,
    signInWithEmail,
    signUpWithEmail,
    resetPasswordWithRecoveryCode,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [role, setRole] = useState<FamilyRole>('marido');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [imgError, setImgError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setBusy(true);

    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else if (mode === 'register') {
        if (!name.trim()) {
          setErrorMsg('Informe seu nome para continuar.');
          setBusy(false);
          return;
        }
        await signUpWithEmail({ name, email, password, role });
      } else {
        await resetPasswordWithRecoveryCode({
          email,
          recoveryCode,
          newPassword: password,
        });
        setMode('login');
        setPassword('');
        setRecoveryCode('');
        setInfoMsg('Senha redefinida com sucesso! Agora você já pode entrar.');
      }
    } catch (err) {
      setErrorMsg(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] grid lg:grid-cols-12 items-stretch">
      {/* Left editorial panel */}
      <div className="lg:col-span-6 relative bg-[#0D3B2E] text-white flex flex-col justify-between p-8 lg:p-14 overflow-hidden min-h-[320px]">
        {!imgError && (
          <img
            src="/src/assets/images/blessed_family_home_1795698352929.jpg"
            alt="Família reunida à mesa em ambiente acolhedor"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#092920] via-[#0D3B2E]/75 to-[#0D3B2E]/65" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#C89B3C] text-[#0D3B2E] font-bold flex items-center justify-center text-lg font-display">
            BF
          </div>
          <span className="text-xl font-bold tracking-tight font-display">Blessed Finance</span>
        </div>

        <div className="relative z-10 space-y-5 max-w-xl my-8 lg:my-0">
          <p className="text-xs font-medium tracking-wide text-[#E6C778]">
            Planejamento e harmonia para o lar
          </p>
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight text-balance">
            Uma família organizada financeiramente constrói um futuro mais tranquilo.
          </h1>
          <p className="text-base text-emerald-100/90 leading-relaxed">
            Pequenas escolhas hoje podem transformar o amanhã.
          </p>
        </div>

        <div className="relative z-10 border-t border-white/15 pt-5 text-xs text-emerald-100/80 leading-relaxed">
          “Deus abençoe nossa casa, nossa família e a maneira como administramos aquilo que chega às
          nossas mãos. Cada pequena economia é um passo para um futuro melhor.”
        </div>
      </div>

      {/* Right auth card */}
      <div className="lg:col-span-6 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-7 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0D3B2E] bg-[#E8F5EE] px-2.5 py-1 rounded-md">
              <Database className="w-3.5 h-3.5" />
              Banco de dados integrado ao projeto
            </div>
            <h2 className="text-2xl font-bold text-slate-900 pt-1">
              {mode === 'login' && 'Entrar na sua conta'}
              {mode === 'register' && 'Criar conta familiar'}
              {mode === 'reset' && 'Redefinir senha'}
            </h2>
            <p className="text-sm text-slate-600">
              {mode === 'login' &&
                'Acesse o painel compartilhado da sua família com sincronização em tempo real.'}
              {mode === 'register' &&
                'Cadastre-se localmente para criar sua família ou entrar usando um convite.'}
              {mode === 'reset' &&
                'Informe seu e-mail, o código de recuperação e escolha uma nova senha.'}
            </p>
          </div>

          {pendingInviteCode && (
            <div className="bg-[#E8F5EE] border border-[#0D3B2E]/20 rounded-lg p-3.5 text-xs text-[#0D3B2E]">
              Convite familiar detectado: <strong className="font-mono">{pendingInviteCode}</strong>.
              Faça login ou crie sua conta para ingressar automaticamente.
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 leading-relaxed">
              {infoMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Seu nome
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: João Silva"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Perfil na família
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'marido', label: 'Marido' },
                        { id: 'esposa', label: 'Esposa' },
                        { id: 'familiar', label: 'Familiar' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRole(opt.id)}
                        className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          role === opt.id
                            ? 'bg-[#0D3B2E] text-white border-[#0D3B2E]'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>

            {mode === 'reset' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Código de recuperação
                </label>
                <input
                  type="text"
                  required
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                  placeholder="Ex.: ABCDE-12345"
                  className="w-full px-3.5 py-2.5 text-sm font-mono uppercase rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  {mode === 'reset' ? 'Nova senha' : 'Senha'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setErrorMsg('');
                      setInfoMsg('');
                    }}
                    className="text-xs text-[#0D3B2E] hover:underline cursor-pointer"
                  >
                    Esqueci minha senha
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:border-[#0D3B2E]"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D3B2E] text-white text-sm font-semibold hover:bg-[#14533F] transition-colors cursor-pointer disabled:opacity-50"
            >
              {mode === 'login' && (
                <>
                  Entrar no painel
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
              {mode === 'register' && (
                <>
                  Criar minha conta
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
              {mode === 'reset' && (
                <>
                  Salvar nova senha
                  <KeyRound className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            {mode === 'login' ? (
              <>
                <span>Ainda não tem conta?</span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMsg('');
                    setInfoMsg('');
                  }}
                  className="font-semibold text-[#0D3B2E] hover:underline cursor-pointer"
                >
                  Criar conta gratuita
                </button>
              </>
            ) : (
              <>
                <span>Já possui uma conta?</span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg('');
                    setInfoMsg('');
                  }}
                  className="font-semibold text-[#0D3B2E] hover:underline cursor-pointer"
                >
                  Voltar para o login
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
            <ShieldCheck className="w-4 h-4 text-[#0D3B2E] shrink-0" />
            <span>
              Tudo roda localmente no projeto, sem credenciais externas e com proteção de senha.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
