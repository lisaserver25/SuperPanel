import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ThemeMode, AccentColor } from './types'

export const ACCENTS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: 'sky', label: 'Azul', swatch: '#0ea5e9' },
  { value: 'violet', label: 'Violeta', swatch: '#8b5cf6' },
  { value: 'emerald', label: 'Esmeralda', swatch: '#10b981' },
  { value: 'amber', label: 'Ámbar', swatch: '#f59e0b' },
  { value: 'rose', label: 'Rosa', swatch: '#f43f5e' },
  { value: 'cyan', label: 'Cian', swatch: '#06b6d4' },
]

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
]

interface ThemeState {
  mode: ThemeMode
  accent: AccentColor
  resolved: 'dark' | 'light'
  setMode: (m: ThemeMode) => void
  setAccent: (a: AccentColor) => void
}

const ThemeContext = createContext<ThemeState | undefined>(undefined)

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function isAccent(v: unknown): v is AccentColor {
  return ACCENTS.some((a) => a.value === v)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored('sp_theme_mode', ['dark', 'light', 'system'] as const, 'dark'))
  const [accent, setAccentState] = useState<AccentColor>(() => {
    try {
      const v = localStorage.getItem('sp_accent')
      return isAccent(v) ? v : 'sky'
    } catch {
      return 'sky'
    }
  })
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveMode(readStored('sp_theme_mode', ['dark', 'light', 'system'] as const, 'dark')))

  // Aplica data-theme (resuelto) y data-accent sobre <html> para el CSS global
  useEffect(() => {
    const r = resolveMode(mode)
    setResolved(r)
    const root = document.documentElement
    root.dataset.theme = r
    root.dataset.accent = accent
  }, [mode, accent])

  // Seguir los cambios del SO cuando el modo es 'system'
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const r = resolveMode('system')
      setResolved(r)
      document.documentElement.dataset.theme = r
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      localStorage.setItem('sp_theme_mode', m)
    } catch {
      /* ignore */
    }
  }, [])

  const setAccent = useCallback((a: AccentColor) => {
    setAccentState(a)
    try {
      localStorage.setItem('sp_accent', a)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ mode, accent, resolved, setMode, setAccent }),
    [mode, accent, resolved, setMode, setAccent]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider')
  return ctx
}

// Carga inicial temprana (antes de React) para evitar destello de tema equivocado
export function applyStoredThemeEarly(): void {
  try {
    const mode = readStored('sp_theme_mode', ['dark', 'light', 'system'] as const, 'dark')
    document.documentElement.dataset.theme = resolveMode(mode)
    const a = localStorage.getItem('sp_accent')
    document.documentElement.dataset.accent = isAccent(a) ? a : 'sky'
  } catch {
    /* ignore */
  }
}
