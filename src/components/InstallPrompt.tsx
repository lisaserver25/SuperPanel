import { useEffect, useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { isStandalone } from '../lib/useIsMobile'

const DISMISS_KEY = 'sp_install_dismissed_at'
const DISMISS_DAYS = 7

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIos(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPadOS 13+ se identifica como Mac con táctil
      (/macintosh/i.test(navigator.userAgent) && 'ontouchend' in document))
  )
}

function wasRecentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

/**
 * Banner de instalación de la PWA:
 *  - Android/Chrome: usa el evento beforeinstallprompt (instalación nativa).
 *  - iOS Safari: muestra las instrucciones «Compartir → Añadir a pantalla de inicio».
 * Se oculta si ya está instalada o si el usuario lo descarta (7 días).
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return

    function onPrompt(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // En iOS no hay beforeinstallprompt: sugerir «Añadir a inicio» una vez
    if (!deferred && isIos()) {
      const timer = window.setTimeout(() => {
        if (!isStandalone() && !wasRecentlyDismissed()) {
          setIosHint(true)
          setVisible(true)
        }
      }, 2500)
      return () => {
        window.removeEventListener('beforeinstallprompt', onPrompt)
        window.clearTimeout(timer)
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') dismiss()
    setDeferred(null)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-3 z-[55] mx-auto max-w-sm animate-sheet-up bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))]">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
          {iosHint ? <Share2 size={20} /> : <Download size={20} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-100">Instalar SuperPaneles</p>
          {iosHint ? (
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              En iPhone/iPad: pulsa <Share2 size={10} className="inline" /> <strong>Compartir</strong> y luego{' '}
              <strong>«Añadir a pantalla de inicio»</strong> para usarla como app.
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
              Añade la app a tu pantalla de inicio para abrir tus paneles con un toque.
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            {!iosHint && (
              <button
                onClick={install}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500"
              >
                Instalar
              </button>
            )}
            <button
              onClick={dismiss}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800"
            >
              {iosHint ? 'Entendido' : 'Ahora no'}
            </button>
          </div>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          title="Cerrar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
