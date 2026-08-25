import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ChevronDown,
  ExternalLink,
  Folder,
  KeyRound,
  LayoutGrid,
  LogOut,
  Search,
  Share2,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTabs } from '../lib/tabs'
import { fetchCredentials, fetchPanels, fetchPendingPanelShares } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { Badge } from './ui'
import type { Panel } from '../lib/types'

export default function Layout() {
  const { user, isSuperadmin } = useAuth()
  const { tabs, activeTabId, openPanelTab, closeTab, switchTab } = useTabs()
  const navigate = useNavigate()

  // Desplegable de paneles en el Header
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [panelSearch, setPanelSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  const panelsQuery = useQuery({ queryKey: ['panels'], queryFn: fetchPanels })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })
  const pendingSharesQuery = useQuery({
    queryKey: ['pending-panel-shares'],
    queryFn: fetchPendingPanelShares,
  })

  const panels = panelsQuery.data ?? []
  const credentials = credsQuery.data ?? []
  const pendingSharesCount = (pendingSharesQuery.data ?? []).length
  const credPanelIds = useMemo(() => new Set(credentials.map((c) => c.panel_id)), [credentials])

  // Cerrar desplegable al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  // Paneles agrupados por categoría para el desplegable
  const groupedPanels = useMemo(() => {
    const q = panelSearch.trim().toLowerCase()
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
  }, [panels, panelSearch])

  const links = [
    { to: '/', label: 'Categorías', icon: LayoutGrid, end: true },
    {
      to: '/shares',
      label: 'Compartir',
      icon: Share2,
      badge: pendingSharesCount > 0 ? pendingSharesCount : undefined,
    },
    { to: '/vault', label: 'Bóveda', icon: KeyRound },
  ]
  if (isSuperadmin) links.push({ to: '/admin/users', label: 'Usuarios', icon: Users, badge: undefined })

  function handleSelectPanelFromDropdown(p: Panel) {
    setDropdownOpen(false)
    setPanelSearch('')
    openPanelTab(p)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Header Principal Ultra-Compacto */}
      <header className="shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur z-40">
        <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-3 py-1.5">
          {/* Logo & Marca */}
          <NavLink to="/" className="flex items-center gap-1.5 font-semibold shrink-0 text-sm">
            <span className="grid h-6 w-6 place-items-center rounded bg-sky-500/20 text-xs text-sky-300 font-bold">
              S
            </span>
            <span className="hidden sm:inline text-xs font-semibold tracking-tight">SuperPaneles</span>
          </NavLink>

          {/* DESPLEGABLE DE PANELES EN EL HEADER */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className={clsx(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                dropdownOpen
                  ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
              )}
            >
              <LayoutGrid size={13} className="text-sky-400" />
              <span>Paneles ({panels.length})</span>
              <ChevronDown size={12} className={clsx('transition-transform duration-200', dropdownOpen && 'rotate-180')} />
            </button>

            {/* Menú Desplegable */}
            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-96 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl z-50 animate-in fade-in-50 zoom-in-95">
                <div className="relative mb-2">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    autoFocus
                    value={panelSearch}
                    onChange={(e) => setPanelSearch(e.target.value)}
                    placeholder="Buscar por nombre, sistema o URL…"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                  {panels.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No hay paneles dados de alta.
                    </div>
                  ) : groupedPanels.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      Ningún panel coincide con la búsqueda.
                    </div>
                  ) : (
                    groupedPanels.map(([category, catPanels]) => (
                      <div key={category} className="space-y-1">
                        <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                          <Folder size={11} className="text-sky-400" />
                          <span>{category}</span>
                          <span className="text-[10px] text-slate-600">({catPanels.length})</span>
                        </div>
                        <div className="space-y-0.5">
                          {catPanels.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleSelectPanelFromDropdown(p)}
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
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Navegación general */}
          <nav className="flex items-center gap-0.5 ml-1">
            {links.map(({ to, label, icon: Icon, end, badge }) => (
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
                {badge !== undefined && (
                  <span className="grid h-3.5 min-w-3.5 place-items-center rounded-full bg-sky-500 px-1 text-[9px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Usuario y Salir */}
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden max-w-[180px] truncate lg:block text-slate-400">{user?.email}</span>
            <button
              className="btn-ghost text-xs px-2 py-1"
              onClick={async () => {
                await supabase.auth.signOut()
                navigate('/login')
              }}
            >
              <LogOut size={13} /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* BARRA DE PESTAÑAS (TAB BAR) ULTRA-COMPACTA */}
        <div className="border-t border-slate-800/80 bg-slate-950/95 px-3 py-0.5">
          <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto no-scrollbar">
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
                  ) : tab.id === 'shares' ? (
                    <Share2 size={12} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
                  ) : (
                    <Users size={12} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
                  )}

                  <span className="truncate text-xs">{tab.title}</span>

                  {tab.category && (
                    <span className="hidden sm:inline text-[10px] text-slate-500 truncate">
                      • {tab.category}
                    </span>
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
        </div>
      </header>

      {/* Contenido de la vista activa (ocupa 100% de la altura restante) */}
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
