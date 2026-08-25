import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { deletePanel, fetchCredentials, fetchPanels } from '../lib/queries'
import { Badge, Button, EmptyState, Input } from '../components/ui'
import PanelFormModal from '../components/PanelFormModal'
import type { Panel } from '../lib/types'

type Filter = 'all' | 'own' | 'third'

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function Dashboard() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Panel | null>(null)
  const [error, setError] = useState('')

  const panelsQuery = useQuery({ queryKey: ['panels'], queryFn: fetchPanels })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })

  const panels = panelsQuery.data ?? []
  const credentials = credsQuery.data ?? []

  // RLS: todo lo que llega ya es del usuario; badge si hay credencial guardada
  const credPanelIds = useMemo(() => new Set(credentials.map((c) => c.panel_id)), [credentials])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return panels.filter((p) => {
      if (filter !== 'all' && p.kind !== filter) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.url.toLowerCase().includes(q)
    })
  }, [panels, filter, search])

  const loading = panelsQuery.isLoading || credsQuery.isLoading

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(p: Panel) {
    setEditing(p)
    setModalOpen(true)
  }

  async function onDelete(p: Panel) {
    if (!window.confirm(`¿Eliminar «${p.name}»? Se borrarán también sus credenciales guardadas.`)) return
    setError('')
    try {
      await deletePanel(p.id)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Mis paneles</h1>
          <p className="text-sm text-slate-400">Añade los paneles a los que tengas acceso y entra con un clic</p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={openCreate}>
          <Plus size={16} /> Añadir panel
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar panel o URL…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
          {(
            [
              ['all', 'Todos'],
              ['own', 'Propios'],
              ['third', 'Terceros'],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm',
                filter === value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <EmptyState>Cargando paneles…</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          {panels.length === 0
            ? 'Todavía no has añadido ningún panel. Pulsa «Añadir panel» para dar de alta el primero (por ejemplo, tu gestlisa).'
            : 'Ningún panel coincide con la búsqueda.'}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((p: Panel) => (
            <div key={p.id} className="card group relative p-4 transition-colors hover:border-sky-600/60">
              <Link to={`/panels/${p.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {p.logo_url ? (
                      <img src={p.logo_url} alt="" className="h-10 w-10 rounded-lg bg-slate-800 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-800 font-semibold text-slate-300">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">{hostname(p.url)}</p>
                    </div>
                  </div>
                  <ExternalLink size={14} className="mt-1 shrink-0 text-slate-600 group-hover:text-sky-400" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone={p.kind === 'own' ? 'sky' : 'violet'}>{p.kind === 'own' ? 'Propio' : 'Tercero'}</Badge>
                  {credPanelIds.has(p.id) && (
                    <Badge tone="green">
                      <KeyRound size={11} /> Cuenta guardada
                    </Badge>
                  )}
                </div>
              </Link>
              <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                <Button
                  className="px-1.5 py-1"
                  title="Editar"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openEdit(p)
                  }}
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  className="px-1.5 py-1 text-red-400"
                  title="Eliminar"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onDelete(p)
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PanelFormModal open={modalOpen} onClose={() => setModalOpen(false)} initial={editing} />
    </div>
  )
}
