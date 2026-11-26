import { useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const { isOnline } = usePWAInstall();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-700" />
      <span>
        Sem conexão com a internet — exibindo os últimos dados sincronizados. Conecte-se para
        salvar alterações entre os celulares da família.
      </span>
    </div>
  );
}

export function PWAInstallButton({ variant = 'header' }: { variant?: 'header' | 'auth' }) {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canInstall) {
      const accepted = await promptInstall();
      if (accepted) return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={
          variant === 'auth'
            ? 'w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-[#0D3B2E]/25 bg-[#E8F5EE] text-[#0D3B2E] text-xs font-semibold hover:bg-[#d8efe2] transition-colors cursor-pointer'
            : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#0D3B2E]/25 bg-[#E8F5EE] text-[#0D3B2E] text-xs font-semibold hover:bg-[#d8efe2] transition-colors cursor-pointer whitespace-nowrap'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className={variant === 'auth' ? '' : 'hidden sm:inline'}>
          Baixar app no celular
        </span>
        {variant === 'header' && <span className="sm:hidden">Baixar app</span>}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#0D3B2E]" />
                <h3 className="text-sm font-bold text-slate-900">
                  {isIOS ? 'Instalar no iPhone / iPad' : 'Instalar no celular (Android / PC)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Instale o <strong>Blessed Finance</strong> na tela inicial do seu celular para usar
              como aplicativo e acompanhar as finanças junto com sua esposa:
            </p>
            {isIOS ? (
              <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside">
                <li>
                  Abra este endereço diretamente no <strong>Safari</strong>.
                </li>
                <li>
                  Toque em <strong>Compartilhar</strong>{' '}
                  <Share className="w-3.5 h-3.5 inline text-[#0D3B2E]" /> na barra inferior.
                </li>
                <li>
                  Escolha <strong>Adicionar à Tela de Início</strong> e toque em{' '}
                  <strong>Adicionar</strong>.
                </li>
              </ol>
            ) : (
              <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside">
                <li>
                  Abra o aplicativo diretamente no navegador (<strong>Chrome</strong> ou{' '}
                  <strong>Edge</strong>).
                </li>
                <li>
                  Toque no menu <strong>⋮</strong> (três pontinhos) no canto superior direito.
                </li>
                <li>
                  Selecione <strong>Instalar aplicativo</strong> ou{' '}
                  <strong>Adicionar à tela inicial</strong>.
                </li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 rounded-lg bg-[#0D3B2E] text-white text-xs font-semibold cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
