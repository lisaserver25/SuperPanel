import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ClipboardCheck,
  ClipboardCopy,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  KeyRound,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { deleteCredential, fetchCredentials, fetchPanels, revealCredential, upsertCredential } from '../lib/queries'
import { useTabs } from '../lib/tabs'
import { Badge, Button, EmptyState, Field, Input, Modal, Select } from '../components/ui'
import type { Panel, PanelCredential } from '../lib/types'

interface FormState {
  id?: string
  panel_id: string
  label: string
  username: string
  password: string
  notes: string
}

const emptyForm: FormState = { panel_id: '', label: '', username: '', password: '', notes: '' }

export default function Vault() {
  const qc = useQueryClient()
  const { openPanelTab } = useTabs()
  const panelsQuery = useQuery({ queryKey: ['panels'], queryFn: fetchPanels })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })

  const panels: Panel[] = panelsQuery.data ?? []
  const credentials: PanelCredential[] = credsQuery.data ?? []

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState('')

  // Filtros
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterSub, setFilterSub] = useState('all')
  const [filterType, setFilterType] = useState<'all' | 'own' | 'shared'>('all')
  // Grupos de servicio expandidos (por defecto todos colapsados)
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set())

  const panelById = useMemo(() => {
    const map = new Map<string, Panel>()
    for (const p of panels) map.set(p.id, p)
    return map
  }, [panels])

  // Filas: credencial + panel asociado (servicio)
  const rows = useMemo(() => {
    return credentials
      .map((c) => ({ cred: c, panel: panelById.get(c.panel_id) ?? null }))
      .filter((r) => r.panel !== null)
      .sort((a, b) => {
        const catA = a.panel!.category || 'General'
        const catB = b.panel!.category || 'General'
        if (catA !== catB) return catA.localeCompare(catB)
        return (a.panel!.name || '').localeCompare(b.panel!.name || '')
      })
  }, [credentials, panelById])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(r.panel!.category || 'General')
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const subservices = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      const sub = r.panel!.subcategory?.trim()
      if (sub && sub !== 'General') set.add(sub)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ cred, panel }) => {
      const cat = panel!.category || 'General'
      const sub = panel!.subcategory || 'General'
      if (filterCategory !== 'all' && cat !== filterCategory) return false
      if (filterSub !== 'all' && sub !== filterSub) return false
      if (filterType === 'own' && panel!.is_shared) return false
      if (filterType === 'shared' && !panel!.is_shared) return false
      if (!q) return true
      return (
        (panel!.name || '').toLowerCase().includes(q) ||
        (panel!.url || '').toLowerCase().includes(q) ||
        (cred.username || '').toLowerCase().includes(q) ||
        (cred.label || '').toLowerCase().includes(q) ||
        (cred.notes || '').toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        sub.toLowerCase().includes(q)
      )
    })
  }, [rows, search, filterCategory, filterSub, filterType])

  function openCreate(panelId = '') {
    setForm({ ...emptyForm, panel_id: panelId || panels[0]?.id || '' })
    setError('')
    setFormOpen(true)
  }

  function openEdit(c: PanelCredential) {
    setForm({
      id: c.id,
      panel_id: c.panel_id,
      label: c.label,
      username: c.username,
      password: '',
      notes: c.notes ?? '',
    })
    setError('')
    setFormOpen(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await upsertCredential({
        id: form.id,
        panel_id: form.panel_id,
        label: form.label.trim(),
        username: form.username.trim(),
        password: form.password || undefined,
        notes: form.notes.trim() || null,
      })
      setFormOpen(false)
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function toggleReveal(c: PanelCredential) {
    if (revealed[c.id] !== undefined) {
      const next = { ...revealed }
      delete next[c.id]
      setRevealed(next)
      return
    }
    try {
      const pw = await revealCredential(c.id)
      setRevealed((r) => ({ ...r, [c.id]: pw || '(vacía)' }))
      window.setTimeout(() => {
        setRevealed((r) => {
          const next = { ...r }
          delete next[c.id]
          return next
        })
      }, 10_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revelar')
    }
  }

  async function copyPassword(c: PanelCredential) {
    try {
      const pw = await revealCredential(c.id)
      await navigator.clipboard.writeText(pw)
      setCopiedId(c.id)
      window.setTimeout(() => setCopiedId(''), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo copiar')
    }
  }

  async function copyUsername(c: PanelCredential) {
    await navigator.clipboard.writeText(c.username)
    setCopiedId(c.id + ':user')
    window.setTimeout(() => setCopiedId(''), 1500)
  }

  async function onDelete(c: PanelCredential) {
    if (!window.confirm(`¿Eliminar el acceso «${c.label}» de ${c.username}?`)) return
    try {
      await deleteCredential(c.id)
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  const hasFilters = search.trim() !== '' || filterCategory !== 'all' || filterSub !== 'all' || filterType !== 'all'

  // Grupos por servicio (panel) a partir de las filas filtradas
  const groups = useMemo(() => {
    const map = new Map<string, { panel: Panel; items: { cred: PanelCredential; panel: Panel }[] }>()
    for (const r of filteredRows) {
      const p = r.panel!
      if (!map.has(p.id)) map.set(p.id, { panel: p, items: [] })
      map.get(p.id)!.items.push({ cred: r.cred, panel: p })
    }
    return Array.from(map.entries())
  }, [filteredRows])

  function togglePanel(panelId: string) {
    setExpandedPanels((prev) => {
      const next = new Set(prev)
      if (next.has(panelId)) next.delete(panelId)
      else next.add(panelId)
      return next
    })
  }

  function expandAll() {
    setExpandedPanels(new Set(groups.map(([id]) => id)))
  }

  function collapseAll() {
    setExpandedPanels(new Set())
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accesos</h1>
          <p className="text-sm text-slate-400">
            Todos los accesos guardados de tus paneles, cifrados en el servidor
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => openCreate(panels[0]?.id ?? '')} disabled={panels.length === 0}>
          <Plus size={16} /> Nuevo acceso
        </Button>
      </div>

      {/* Filtros + buscador */}
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por panel, usuario, etiqueta, notas…"
            className="py-1 pl-8 text-xs"
          />
        </div>
        <Select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="w-auto min-w-[150px] py-1 text-xs"
          title="Filtrar por categoría (servicio global)"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={filterSub}
          onChange={(e) => setFilterSub(e.target.value)}
          className="w-auto min-w-[140px] py-1 text-xs"
          title="Filtrar por subservicio"
        >
          <option value="all">Todos los subservicios</option>
          {subservices.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as 'all' | 'own' | 'shared')}
          className="w-auto min-w-[120px] py-1 text-xs"
          title="Filtrar por tipo"
        >
          <option value="all">Todos</option>
          <option value="own">Propios</option>
          <option value="shared">Compartidos</option>
        </Select>
        {hasFilters && (
          <Button
            className="px-2 py-1 text-xs text-slate-400"
            onClick={() => {
              setSearch('')
              setFilterCategory('all')
              setFilterSub('all')
              setFilterType('all')
            }}
            title="Limpiar filtros"
          >
            Limpiar
          </Button>
        )}
        {!hasFilters && (
          <div className="ml-auto flex items-center gap-1">
            <Button className="px-2 py-1 text-xs" onClick={expandAll} title="Expandir todos los servicios">
              Expandir todo
            </Button>
            <Button className="px-2 py-1 text-xs" onClick={collapseAll} title="Colapsar todos los servicios">
              Colapsar todo
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {panels.length === 0 ? (
        <EmptyState>No hay paneles dados de alta todavía.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>Todavía no has guardado accesos. Añade el primero con «Nuevo acceso».</EmptyState>
      ) : filteredRows.length === 0 ? (
        <EmptyState>Ningún acceso coincide con los filtros.</EmptyState>
      ) : (
        <div className="card overflow-hidden">
          {groups.map(([panelId, group]) => {
            const isExpanded = hasFilters || expandedPanels.has(panelId)
            const cat = group.panel.category || 'General'
            const sub = group.panel.subcategory || 'General'
            return (
              <section key={panelId} className="border-b border-slate-800 last:border-b-0">
                {/* Cabecera del servicio (clic = colapsar/expandir) */}
                <div className="flex items-center gap-1 px-2 py-2 bg-slate-950/50">
                  <button
                    type="button"
                    onClick={() => togglePanel(panelId)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-0.5 text-left transition-colors hover:bg-slate-800/40 rounded-lg"
                    title={isExpanded ? 'Colapsar' : `Mostrar los ${group.items.length} accesos de «${group.panel.name}»`}
                  >
                    <ChevronDown
                      size={14}
                      className={clsx('shrink-0 text-slate-500 transition-transform duration-200', isExpanded && 'rotate-180')}
                    />
                    {group.panel.logo_url ? (
                      <img
                        src={group.panel.logo_url}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-lg bg-slate-800 object-contain p-0.5 ring-1 ring-slate-700/50"
                      />
                    ) : (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-800 text-[11px] font-bold text-slate-300 ring-1 ring-slate-700/50">
                        {(group.panel.name || 'P').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                      {group.panel.name}
                    </span>
                    <Badge tone="slate">
                      <Folder size={10} /> {cat}
                    </Badge>
                    {sub !== 'General' && (
                      <Badge tone="sky">
                        <Layers size={10} /> {sub}
                      </Badge>
                    )}
                    {group.panel.is_shared && (
                      <Badge tone="violet">
                        <Users size={10} /> Compartido
                      </Badge>
                    )}
                    <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-400">
                      {group.items.length} {group.items.length === 1 ? 'acceso' : 'accesos'}
                    </span>
                  </button>
                  <Button
                    className="px-2 py-1 text-xs text-sky-400 shrink-0"
                    title={`Abrir ${group.panel.name}`}
                    onClick={() => openPanelTab(group.panel)}
                  >
                    <ExternalLink size={13} />
                  </Button>
                </div>

                {/* Accesos del servicio */}
                {isExpanded && (
                  <ul className="divide-y divide-slate-800/60">
                    {group.items.map(({ cred }) => (
                      <li key={cred.id} className="flex flex-wrap items-center gap-2 px-3 py-2 pl-11 hover:bg-slate-800/40 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-slate-200">{cred.label}</span>
                            <span className="truncate font-mono text-[11px] text-slate-400">{cred.username}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                            <span className="truncate font-mono text-amber-300/90">
                              {revealed[cred.id] !== undefined ? revealed[cred.id] : '••••••••••••'}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <Button className="px-2 py-1 text-xs" onClick={() => copyUsername(cred)} title="Copiar usuario">
                            {copiedId === cred.id + ':user' ? (
                              <ClipboardCheck size={13} className="text-emerald-400" />
                            ) : (
                              <ClipboardCopy size={13} />
                            )}
                          </Button>
                          <Button className="px-2 py-1 text-xs" onClick={() => copyPassword(cred)} title="Copiar contraseña">
                            {copiedId === cred.id ? (
                              <ClipboardCheck size={13} className="text-emerald-400" />
                            ) : (
                              <KeyRound size={13} />
                            )}
                          </Button>
                          <Button className="px-2 py-1 text-xs" onClick={() => toggleReveal(cred)} title="Revelar (10 s)">
                            {revealed[cred.id] !== undefined ? <EyeOff size={13} /> : <Eye size={13} />}
                          </Button>
                          <Button className="px-2 py-1 text-xs" onClick={() => openEdit(cred)} title="Editar">
                            <Pencil size={13} />
                          </Button>
                          <Button className="px-2 py-1 text-xs text-red-400" onClick={() => onDelete(cred)} title="Eliminar">
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={form.id ? 'Editar acceso' : 'Nuevo acceso'}>
        <form className="space-y-3" onSubmit={onSubmit}>
          <Field label="Panel">
            <Select required value={form.panel_id} onChange={(e) => setForm((f) => ({ ...f, panel_id: e.target.value }))}>
              <option value="" disabled>
                Selecciona un panel…
              </option>
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category || 'General'}) {p.is_shared ? '• Compartido' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Etiqueta">
            <Input
              required
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Ej: Admin Tokyo"
            />
          </Field>
          <Field label="Usuario (email del panel)">
            <Input
              required
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="usuario@panel.com"
              autoComplete="off"
            />
          </Field>
          <Field label={form.id ? 'Contraseña (vacío = sin cambios)' : 'Contraseña'}>
            <Input
              type="password"
              required={!form.id}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Notas (opcional)">
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={saving || !form.panel_id}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
