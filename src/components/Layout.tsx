import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ChevronDown,
  ExternalLink,
  Folder,
  KeyRound,
  LayoutGrid,
  LogOut,
  Palette,
  PanelBottom,
  PanelLeft,
  PanelTop,
  Search,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTabs } from '../lib/tabs'
import { fetchBrandingSettings, fetchCredentials, fetchPanels, updateMyMenuStyle } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { Badge } from './ui'
import type { MenuStyle, Panel } from '../lib/types'

const STYLE_OPTIONS: { value: MenuStyle; label: string; icon: typeof PanelTop; hint: string }[] = [
  { value: 'top', label: 'Barra superior', icon: PanelTop, hint: 'Menú compacto arriba' },
  { value: 'side', label: 'Lateral', icon: PanelLeft, hint: 'Menú vertical a la izquierda' },
  { value: 'dock', label: 'Flotante inferior', icon: PanelBottom, hint: 'Dock flotante estilo iOS' },
]

function readStoredStyle(): MenuStyle | null {
  try {
    const v = localStorage.getItem('sp_menu_style')
    return v === 'top' || v === 'side' || v === 'dock' ? v : null
  } catch {
    return null
  }
}

// Selector de estilo de menú (preferencia personal del usuario)
function StyleSelector({ current, onPick }: { current: MenuStyle; onPick: (s: MenuStyle) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const CurrentIcon = STYLE_OPTIONS.find((o) => o.value === current)?.icon ?? PanelBottom

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className={clsx(
          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
          open
            ? 'border-sky-500 bg-sky-500/15 text-sky-200'
            : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:text-white'
        )}
        title="Cambiar estilo del menú (preferencia personal)"
      >
        <CurrentIcon size={13} />
        <span className="hidden lg:inline">Menú</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-slate-800 bg-slate-900 p-1.5 shadow-2xl">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Estilo del menú
          </p>
          {STYLE_OPTIONS.map(({ value, label, icon: Icon, hint }) => (
            <button
              key={value}
              onClick={() => {
                onPick(value)
                setOpen(false)
              }}
              className={clsx(
                'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                current === value ? 'bg-sky-500/15 text-sky-200' : 'text-slate-300 hover:bg-slate-800'
              )}
            >
              <Icon size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">{label}</span>
                <span className="block text-[10px] text-slate-500">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Contenido del lanzador de paneles (buscador + agrupado por categoría)
function PanelsMenuContent({
  panels,
  credPanelIds,
  onPick,
}: {
  panels: Panel[]
  credPanelIds: Set<string>
  onPick: (p: Panel) => void
}) {
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = panels.filter((p) => {
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      )
    })
    const groups: Record<string, Panel[]> = {}
    for (const p of filtered) {
      const cat = p.category || 'General'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [panels, search])

  return (
    <div className="space-y-2 p-2">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar panel o categoría…"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
        />
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
        {panels.length === 0 ? (
          <div className="p-3 text-center text-xs text-slate-500">No hay paneles dados de alta.</div>
        ) : grouped.length === 0 ? (
          <div className="p-3 text-center text-xs text-slate-500">Ningún panel coincide con la búsqueda.</div>
        ) : (
          grouped.map(([category, catPanels]) => (
            <div key={category} className="space-y-0.5">
              <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                <Folder size={11} className="text-sky-400" />
                <span>{category}</span>
                <span className="text-[10px] text-slate-600">({catPanels.length})</span>
              </div>
              {catPanels.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPick(p)}
                  className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-slate-800"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {p.logo_url ? (
                      <img src={p.logo_url} alt="" className="h-4 w-4 rounded bg-slate-800 object-cover" />
                    ) : (
                      <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-slate-800 text-[9px] font-bold text-slate-300">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-200 group-hover:text-white text-xs">{p.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{p.url}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.is_shared && <Badge tone="violet">Compartido</Badge>}
                    {credPanelIds.has(p.id) && (
                      <span title="Credencial guardada" className="text-emerald-400">
                        <KeyRound size={11} />
                      </span>
                    )}
                    <ExternalLink size={11} className="text-slate-600 group-hover:text-sky-400" />
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Barra de pestañas abiertas (común a todos los estilos)
function TabStrip() {
  const { tabs, activeTabId, closeTab, switchTab } = useTabs()

  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id
        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={clsx(
              'group flex max-w-[200px] h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-t border-b-2 px-2.5 py-1 text-xs transition-all select-none',
              isActive
                ? 'border-sky-500 bg-slate-800/90 text-white font-medium shadow-xs'
                : 'border-transparent bg-slate-900/50 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            )}
            title={tab.title}
          >
            {tab.panelId ? (
              tab.logo_url ? (
                <img src={tab.logo_url} alt="" className="h-3 w-3 rounded object-cover" />
              ) : (
                <span className="grid h-3 w-3 place-items-center rounded bg-slate-700 text-[8px] font-bold text-slate-300">
                  {tab.title.slice(0, 1).toUpperCase()}
                </span>
              )
            ) : tab.id === 'dashboard' ? (
              <LayoutGrid size={12} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
            ) : tab.id === 'vault' ? (
              <KeyRound size={12} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
            ) : (
              <Users size={12} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
            )}

            <span className="truncate text-xs">{tab.title}</span>

            {tab.category && (
              <span className="hidden sm:inline text-[10px] text-slate-500 truncate">• {tab.category}</span>
            )}

            {tab.closable && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="ml-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200 transition-colors"
                title="Cerrar pestaña"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Dock flotante inferior estilo iOS
function FloatingDock({
  navItems,
  panels,
  credPanelIds,
  onPickPanel,
  onLogout,
}: {
  navItems: { to: string; label: string; icon: typeof LayoutGrid; end?: boolean }[]
  panels: Panel[]
  credPanelIds: Set<string>
  onPickPanel: (p: Panel) => void
  onLogout: () => void
}) {
  const [panelsOpen, setPanelsOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dockRef.current && !dockRef.current.contains(e.target as Node)) setPanelsOpen(false)
    }
    if (panelsOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [panelsOpen])

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2" ref={dockRef}>
      {/* Popover de paneles (se abre hacia arriba) */}
      {panelsOpen && (
        <div className="absolute bottom-full left-1/2 mb-3 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-xl animate-in fade-in-50 zoom-in-95">
          <PanelsMenuContent panels={panels} credPanelIds={credPanelIds} onPick={(p) => { setPanelsOpen(false); onPickPanel(p) }} />
        </div>
      )}

      {/* Dock */}
      <div className="flex items-end gap-1 rounded-3xl border border-white/10 bg-slate-900/80 px-3 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
        {/* Lanzador de paneles */}
        <button
          onClick={() => setPanelsOpen((p) => !p)}
          className={clsx(
            'group relative grid h-11 w-11 place-items-center rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:bg-white/10 active:scale-95',
            panelsOpen && 'bg-white/10 -translate-y-1'
          )}
          title="Paneles"
        >
          <LayoutGrid size={20} className={panelsOpen ? 'text-sky-300' : 'text-slate-300 group-hover:text-white'} />
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-sky-500 px-1 text-[9px] font-bold text-white">
            {panels.length}
          </span>
          <span className="absolute -bottom-0.5 text-[8px] font-medium text-slate-400 group-hover:text-slate-200">
            Paneles
          </span>
        </button>

        <span className="mx-1 h-8 w-px self-center bg-white/10" />

        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'group relative grid h-11 w-11 place-items-center rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:bg-white/10 active:scale-95',
                isActive && 'bg-white/10 -translate-y-1'
              )
            }
            title={label}
          >
            {({ isActive }) => (
              <>
                <Icon size={20} className={isActive ? 'text-sky-300' : 'text-slate-300 group-hover:text-white'} />
                <span className="absolute -bottom-0.5 text-[8px] font-medium text-slate-400 group-hover:text-slate-200">
                  {label}
                </span>
                {isActive && <span className="absolute -top-1 h-1 w-1 rounded-full bg-sky-400" />}
              </>
            )}
          </NavLink>
        ))}

        <span className="mx-1 h-8 w-px self-center bg-white/10" />

        <button
          onClick={onLogout}
          className="group grid h-11 w-11 place-items-center rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:bg-red-500/20 active:scale-95"
          title="Cerrar sesión"
        >
          <LogOut size={19} className="text-slate-300 group-hover:text-red-300" />
          <span className="absolute -bottom-0.5 text-[8px] font-medium text-slate-400 group-hover:text-slate-200">
            Salir
          </span>
        </button>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, profile, isSuperadmin } = useAuth()
  const { openPanelTab } = useTabs()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const settingsQuery = useQuery({ queryKey: ['super-settings'], queryFn: fetchBrandingSettings })
  const panelsQuery = useQuery({ queryKey: ['panels'], queryFn: fetchPanels })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })

  const panels = panelsQuery.data ?? []
  const credentials = credsQuery.data ?? []
  const credPanelIds = useMemo(() => new Set(credentials.map((c) => c.panel_id)), [credentials])

  // Estilo de menú: preferencia local inmediata → perfil del usuario → por defecto del hub
  const [localStyle, setLocalStyle] = useState<MenuStyle | null>(readStoredStyle)
  const menuStyle: MenuStyle =
    localStyle ?? profile?.menu_style ?? settingsQuery.data?.default_menu_style ?? 'dock'

  async function pickStyle(s: MenuStyle) {
    setLocalStyle(s)
    try {
      await updateMyMenuStyle(s)
      await qc.invalidateQueries({ queryKey: ['profile'] })
    } catch {
      /* la preferencia local ya quedó aplicada */
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const navItems: { to: string; label: string; icon: typeof LayoutGrid; end?: boolean }[] = [
    { to: '/', label: 'Categorías', icon: LayoutGrid, end: true },
    { to: '/vault', label: 'Contraseñas', icon: KeyRound },
  ]
  if (isSuperadmin) {
    navItems.push({ to: '/admin/users', label: 'Usuarios', icon: Users })
    navItems.push({ to: '/admin/branding', label: 'Personaliz.', icon: Palette })
  }

  const brand = (
    <NavLink to="/" className="flex items-center gap-1.5 font-semibold shrink-0 text-sm">
      <span className="grid h-6 w-6 place-items-center rounded bg-sky-500/20 text-xs text-sky-300 font-bold">S</span>
      <span className="hidden sm:inline text-xs font-semibold tracking-tight">
        {settingsQuery.data?.site_name ?? 'SuperPanel'}
      </span>
    </NavLink>
  )

  const content = (
    <main className={clsx('flex min-h-0 flex-1 flex-col overflow-y-auto', menuStyle === 'dock' && 'pb-24')}>
      <Outlet />
    </main>
  )

  // ---------------------------------------------------------------- DOCK (iOS)
  if (menuStyle === 'dock') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
        <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur z-40">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-1.5">
            {brand}
            <div className="min-w-0 flex-1 overflow-x-auto no-scrollbar">
              <TabStrip />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-slate-400">
              <span className="hidden max-w-[160px] truncate xl:block">{user?.email}</span>
              <StyleSelector current={menuStyle} onPick={pickStyle} />
            </div>
          </div>
        </header>

        {content}

        <FloatingDock
          navItems={navItems}
          panels={panels}
          credPanelIds={credPanelIds}
          onPickPanel={openPanelTab}
          onLogout={handleLogout}
        />
      </div>
    )
  }

  // ------------------------------------------------------------------- LATERAL
  if (menuStyle === 'side') {
    return (
      <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
        <aside className="flex w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900/95">
          <div className="px-3 py-2.5">{brand}</div>

          <SidebarPanelsLauncher panels={panels} credPanelIds={credPanelIds} onPickPanel={openPanelTab} />

          <nav className="mt-1 flex flex-col gap-0.5 px-2">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    isActive ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  )
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-2 border-t border-slate-800 p-2.5">
            <StyleSelector current={menuStyle} onPick={pickStyle} />
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span className="truncate" title={user?.email}>
                {user?.email}
              </span>
              <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={handleLogout} title="Cerrar sesión">
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-800 bg-slate-950/95 px-3 py-0.5">
            <TabStrip />
          </div>
          {content}
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------- BARRA SUPERIOR
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur z-40">
        <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-3 py-1.5">
          {brand}
          <TopPanelsDropdown panels={panels} credPanelIds={credPanelIds} onPickPanel={openPanelTab} />

          <nav className="flex items-center gap-0.5 ml-1">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    'relative flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    isActive ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  )
                }
              >
                <Icon size={13} />
                <span className="hidden md:inline">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden max-w-[180px] truncate lg:block">{user?.email}</span>
            <StyleSelector current={menuStyle} onPick={pickStyle} />
            <button className="btn-ghost text-xs px-2 py-1" onClick={handleLogout}>
              <LogOut size={13} /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800/80 bg-slate-950/95 px-3 py-0.5">
          <div className="mx-auto max-w-7xl">
            <TabStrip />
          </div>
        </div>
      </header>

      {content}
    </div>
  )
}

// Lanzador de paneles desplegable de la barra superior
function TopPanelsDropdown({
  panels,
  credPanelIds,
  onPickPanel,
}: {
  panels: Panel[]
  credPanelIds: Set<string>
  onPickPanel: (p: Panel) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className={clsx(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
          open
            ? 'border-sky-500 bg-sky-500/15 text-sky-200'
            : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
        )}
      >
        <LayoutGrid size={13} className="text-sky-400" />
        <span>Paneles ({panels.length})</span>
        <ChevronDown size={12} className={clsx('transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-96 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl z-50 animate-in fade-in-50 zoom-in-95">
          <PanelsMenuContent panels={panels} credPanelIds={credPanelIds} onPick={(p) => { setOpen(false); onPickPanel(p) }} />
        </div>
      )}
    </div>
  )
}

// Lanzador de paneles del menú lateral
function SidebarPanelsLauncher({
  panels,
  credPanelIds,
  onPickPanel,
}: {
  panels: Panel[]
  credPanelIds: Set<string>
  onPickPanel: (p: Panel) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={ref} className="px-2">
      <button
        onClick={() => setOpen((p) => !p)}
        className={clsx(
          'flex w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
          open
            ? 'border-sky-500 bg-sky-500/15 text-sky-200'
            : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
        )}
      >
        <LayoutGrid size={13} className="text-sky-400" />
        <span>Paneles ({panels.length})</span>
        <ChevronDown size={12} className={clsx('ml-auto transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
          <PanelsMenuContent panels={panels} credPanelIds={credPanelIds} onPick={(p) => { setOpen(false); onPickPanel(p) }} />
        </div>
      )}
    </div>
  )
}
