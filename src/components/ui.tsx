import { useEffect } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'ghost' | 'danger'

export function Button({
  variant = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variantClass = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost'
  return <button className={clsx(variantClass, className)} {...props} />
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('input', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx('input', className)} {...props} />
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

type BadgeTone = 'slate' | 'sky' | 'violet' | 'green' | 'red'

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    slate: 'bg-slate-800 text-slate-300',
    sky: 'bg-sky-500/15 text-sky-300',
    violet: 'bg-violet-500/15 text-violet-300',
    green: 'bg-emerald-500/15 text-emerald-300',
    red: 'bg-red-500/15 text-red-300',
  }
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}

/** Bloquea el scroll del body mientras el overlay esté abierto (evita el rebote en iOS). */
function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])
}

/**
 * Modal adaptable: en móvil (Android/iOS) se comporta como una hoja inferior
 * (bottom sheet) con asa superior y área segura; en escritorio es un modal centrado.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: string
}) {
  useLockBodyScroll(open)

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={clsx(
          'card max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-b-none rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-sheet-up sm:rounded-xl sm:p-5',
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Asa de la hoja (solo móvil) */}
        <div className="mx-auto mb-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-600 sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="mb-1 text-base sm:text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 mb-1 shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 sm:hidden"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Hoja inferior (bottom sheet) deslizante para menús del shell móvil:
 * lanzador de paneles, apariencia, etc. Se cierra tocando el fondo.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = 'max-h-[78dvh]',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  maxHeight?: string
}) {
  useLockBodyScroll(open)

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className={clsx(
          'flex w-full flex-col rounded-t-2xl border-x border-t border-slate-800 bg-slate-900 shadow-2xl shadow-black/60 animate-sheet-up',
          maxHeight
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Asa + cabecera */}
        <div className="shrink-0 px-3 pt-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-slate-600" />
          {title && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                title="Cerrar"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">{children}</p>
}
