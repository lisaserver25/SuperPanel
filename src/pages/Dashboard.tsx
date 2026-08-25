import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ExternalLink,
  Folder,
  FolderEdit,
  FolderPlus,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'
import {
  deletePanel,
  fetchCredentials,
  fetchPanels,
  fetchPendingPanelShares,
  removePanelShare,
  renameCategory,
  respondPanelShare,
  updatePanelShareCategory,
} from '../lib/queries'
import { Badge, Button, EmptyState, Field, Input, Modal } from '../components/ui'
import { useTabs } from '../lib/tabs'
import PanelFormModal from '../components/PanelFormModal'
import type { Panel, PanelShare } from '../lib/types'

type FilterKind = 'all' | 'own' | 'third' | 'shared'

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function Dashboard() {
  const qc = useQueryClient()
  const { openPanelTab } = useTabs()
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState<FilterKind>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Panel | null>(null)
  const [targetCatForNewPanel, setTargetCatForNewPanel] = useState<string>('General')
  const [error, setError] = useState('')

  // Modal para crear nueva categoría directamente
  const [newCatModalOpen, setNewCatModalOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  // Modal para renombrar / editar una categoría existente
  const [renamingCategory, setRenamingCategory] = useState<{ oldName: string; newName: string } | null>(null)

  // Modales de categoría de panel compartido
  const [acceptingShare, setAcceptingShare] = useState<PanelShare | null>(null)
  const [acceptCategory, setAcceptCategory] = useState('General')
  const [editingCustomCategory, setEditingCustomCategory] = useState<{ shareId: string; category: string } | null>(null)

  const panelsQuery = useQuery({ queryKey: ['panels'], queryFn: fetchPanels })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })
  const pendingSharesQuery = useQuery({
    queryKey: ['pending-panel-shares'],
    queryFn: fetchPendingPanelShares,
  })

  const panels = panelsQuery.data ?? []
  const credentials = credsQuery.data ?? []
  const pendingShares = pendingSharesQuery.data ?? []

  // IDs de paneles con credencial guardada
  const credPanelIds = useMemo(() => new Set(credentials.map((c) => c.panel_id)), [credentials])

  // Todas las categorías existentes
  const existingCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of panels) {
      if (p.category) set.add(p.category)
    }
    return Array.from(set).sort()
  }, [panels])

  // Filtrado de paneles
  const visiblePanels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return panels.filter((p) => {
      if (filterKind === 'own' && (p.kind !== 'own' || p.is_shared)) return false
      if (filterKind === 'third' && (p.kind !== 'third' || p.is_shared)) return false
      if (filterKind === 'shared' && !p.is_shared) return false

      const panelCat = p.category || 'General'
      if (selectedCategory !== 'all' && panelCat !== selectedCategory) return false

      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        panelCat.toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      )
    })
  }, [panels, filterKind, selectedCategory, search])

  // Agrupación por categoría
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, Panel[]> = {}
    for (const p of visiblePanels) {
      const cat = p.category || 'General'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [visiblePanels])

  const loading = panelsQuery.isLoading || credsQuery.isLoading

  function openCreate(categoryName = 'General') {
    setEditing(null)
    setTargetCatForNewPanel(categoryName)
    setModalOpen(true)
  }

  function openEdit(p: Panel) {
    setEditing(p)
    setTargetCatForNewPanel(p.category || 'General')
    setModalOpen(true)
  }

  function handleCreateNewCategory(e: FormEvent) {
    e.preventDefault()
    const cat = newCatName.trim()
    if (!cat) return
    setNewCatModalOpen(false)
    setNewCatName('')
    openCreate(cat)
  }

  async function handleRenameCategory(e: FormEvent) {
    e.preventDefault()
    if (!renamingCategory) return
    const { oldName, newName } = renamingCategory
    if (!newName.trim()) return

    setError('')
    try {
      await renameCategory(oldName, newName.trim())
      setRenamingCategory(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      if (selectedCategory === oldName) {
        setSelectedCategory(newName.trim())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar la categoría')
    }
  }

  async function onDelete(p: Panel) {
    if (p.is_shared && p.share_id) {
      if (!window.confirm(`¿Dejar de acceder al panel compartido «${p.name}»?`)) return
      setError('')
      try {
        await removePanelShare(p.share_id)
        await qc.invalidateQueries({ queryKey: ['panels'] })
        await qc.invalidateQueries({ queryKey: ['credentials'] })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo eliminar el acceso compartido')
      }
      return
    }

    if (!window.confirm(`¿Eliminar «${p.name}»? Se borrarán también sus credenciales y accesos compartidos.`)) return
    setError('')
    try {
      await deletePanel(p.id)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el panel')
    }
  }

  async function onAcceptPendingShare(e: FormEvent) {
    e.preventDefault()
    if (!acceptingShare) return
    setError('')
    try {
      await respondPanelShare(acceptingShare.id, true, acceptCategory.trim() || 'General')
      setAcceptingShare(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      await qc.invalidateQueries({ queryKey: ['pending-panel-shares'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    }
  }

  async function onSaveCustomCategory(e: FormEvent) {
    e.preventDefault()
    if (!editingCustomCategory) return
    setError('')
    try {
      await updatePanelShareCategory(editingCustomCategory.shareId, editingCustomCategory.category.trim() || 'General')
      setEditingCustomCategory(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la categoría')
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4">
      {/* Encabezado y acciones principales */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Categorías & Paneles</h1>
          <p className="text-sm text-slate-400">
            Crea categorías personalizadas, organiza tus paneles, edítalos y accede a ellos en pestañas
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Button onClick={() => setNewCatModalOpen(true)} className="text-xs bg-slate-800 hover:bg-slate-700">
            <FolderPlus size={15} className="text-sky-400" /> Añadir categoría
          </Button>
          <Button variant="primary" onClick={() => openCreate('General')}>
            <Plus size={16} /> Añadir panel
          </Button>
        </div>
      </div>

      {/* Banner de invitaciones de paneles pendientes */}
      {pendingShares.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/40 bg-sky-950/30 p-3.5 text-sm">
          <div className="flex items-center gap-2.5">
            <Share2 className="text-sky-400 shrink-0" size={18} />
            <div>
              <p className="font-semibold text-sky-200">
                Tienes {pendingShares.length} invitación{pendingShares.length > 1 ? 'es' : ''} a paneles pendientes
              </p>
              <p className="text-xs text-slate-400">
                Acepta las invitaciones para agregarlas a tu catálogo y organizarlas en tu categoría deseada.
              </p>
            </div>
          </div>
          <Link to="/shares" className="btn-primary text-xs shrink-0">
            Ver y aceptar invitaciones
          </Link>
        </div>
      )}

      {/* Barra de filtros y búsqueda */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Buscador */}
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por panel, URL o sistema…"
            className="pl-9 text-xs sm:text-sm"
          />
        </div>

        {/* Filtro por tipo / compartidos */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          {(
            [
              ['all', 'Todos'],
              ['own', 'Propios'],
              ['third', 'Terceros'],
              ['shared', 'Compartidos'],
            ] as [FilterKind, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilterKind(value)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs sm:text-sm transition-colors',
                filterKind === value ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Píldoras de filtro por Categoría / Sistema */}
      {existingCategories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-xs font-semibold text-slate-500 mr-1 shrink-0">Categoría:</span>
          <button
            onClick={() => setSelectedCategory('all')}
            className={clsx(
              'rounded-full px-3 py-1 text-xs transition-colors shrink-0',
              selectedCategory === 'all'
                ? 'bg-sky-500 text-white font-medium shadow-sm'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            )}
          >
            Todas ({panels.length})
          </button>
          {existingCategories.map((cat) => {
            const count = panels.filter((p) => (p.category || 'General') === cat).length
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={clsx(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors shrink-0',
                  selectedCategory === cat
                    ? 'bg-sky-500 text-white font-medium shadow-sm'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                )}
              >
                <span>{cat}</span>
                <span className={selectedCategory === cat ? 'text-sky-100' : 'text-slate-500'}>({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Lista de Paneles agrupados por Categoría */}
      {loading ? (
        <EmptyState>Cargando paneles y categorías…</EmptyState>
      ) : visiblePanels.length === 0 ? (
        <EmptyState>
          {panels.length === 0
            ? 'Todavía no has añadido ningún panel. Pulsa «Añadir categoría» o «Añadir panel» para comenzar.'
            : 'Ningún panel coincide con los filtros seleccionados.'}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groupedByCategory.map(([category, catPanels]) => (
            <section key={category} className="space-y-3.5">
              {/* Cabecera de Categoría con botones de Renombrar y Añadir panel */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded bg-sky-500/10 text-sky-400 font-semibold text-xs">
                    <Folder size={15} />
                  </span>
                  <h2 className="text-base font-semibold tracking-wide text-slate-100">
                    {category}
                  </h2>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400 font-mono">
                    {catPanels.length} {catPanels.length === 1 ? 'panel' : 'paneles'}
                  </span>

                  {/* Botón para Renombrar / Editar Categoría */}
                  <button
                    type="button"
                    onClick={() => setRenamingCategory({ oldName: category, newName: category })}
                    className="p-1 text-slate-500 hover:text-sky-300 transition-colors"
                    title={`Editar nombre de la categoría «${category}»`}
                  >
                    <Pencil size={13} />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    className="text-xs px-2.5 py-1 text-slate-300 hover:text-white border border-slate-800 bg-slate-900/60"
                    onClick={() => setRenamingCategory({ oldName: category, newName: category })}
                    title={`Editar nombre de la categoría «${category}»`}
                  >
                    <FolderEdit size={13} /> Renombrar categoría
                  </Button>
                  <Button
                    className="text-xs px-2.5 py-1 text-sky-300 hover:text-sky-200 border border-slate-800 hover:border-slate-700 bg-slate-900/60"
                    onClick={() => openCreate(category)}
                    title={`Añadir un panel directamente a ${category}`}
                  >
                    <Plus size={13} /> Añadir panel a {category}
                  </Button>
                </div>
              </div>

              {/* Grid de Tarjetas de Panel */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {catPanels.map((p: Panel) => (
                  <div
                    key={p.id}
                    className="card flex flex-col justify-between p-4 transition-all hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-950/30"
                  >
                    <div>
                      {/* Cabecera de Tarjeta: Logo y Título */}
                      <div className="flex items-start justify-between gap-2">
                        <div
                          onClick={() => openPanelTab(p)}
                          className="flex min-w-0 items-center gap-3 cursor-pointer flex-1"
                          title="Abrir en pestaña"
                        >
                          {p.logo_url ? (
                            <img src={p.logo_url} alt="" className="h-10 w-10 rounded-lg bg-slate-800 object-cover shrink-0" />
                          ) : (
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-800 font-bold text-slate-300">
                              {p.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-100 hover:text-sky-300 transition-colors">
                              {p.name}
                            </p>
                            <p className="truncate text-xs text-slate-500">{hostname(p.url)}</p>
                          </div>
                        </div>

                        <button
                          onClick={() => openPanelTab(p)}
                          className="p-1 text-slate-500 hover:text-sky-400 transition-colors shrink-0"
                          title="Abrir en pestaña"
                        >
                          <ExternalLink size={15} />
                        </button>
                      </div>

                      {/* Badges de Tipo, Compartición y Credencial */}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge tone={p.kind === 'own' ? 'sky' : 'violet'}>
                          {p.kind === 'own' ? 'Propio' : 'Tercero'}
                        </Badge>

                        {p.is_shared && (
                          <Badge tone="violet">
                            <Users size={11} /> {p.shared_by_name ? `De ${p.shared_by_name.split(' ')[0]}` : 'Compartido'}
                          </Badge>
                        )}

                        {credPanelIds.has(p.id) && (
                          <Badge tone="green">
                            <KeyRound size={11} /> Cuenta lista
                          </Badge>
                        )}
                      </div>

                      {p.notes && (
                        <p className="mt-2 text-xs text-slate-400 line-clamp-1 italic">
                          {p.notes}
                        </p>
                      )}
                    </div>

                    {/* Barra de Acciones Clara y Accesible */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs">
                      <Button
                        variant="primary"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => openPanelTab(p)}
                      >
                        Abrir pestaña
                      </Button>

                      <div className="flex items-center gap-1">
                        {p.is_shared && p.share_id ? (
                          <Button
                            className="px-2 py-1 text-xs"
                            title="Cambiar categoría personal"
                            onClick={() => setEditingCustomCategory({ shareId: p.share_id!, category: p.category })}
                          >
                            <FolderEdit size={13} />
                          </Button>
                        ) : (
                          <Button
                            className="px-2 py-1 text-xs text-slate-300 hover:text-white"
                            title="Editar panel"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil size={13} /> <span className="hidden sm:inline">Editar</span>
                          </Button>
                        )}

                        <Button
                          className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                          title={p.is_shared ? 'Dejar de acceder a este panel compartido' : 'Eliminar panel'}
                          onClick={() => onDelete(p)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modal para crear o editar un panel */}
      <PanelFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
        defaultCategory={targetCatForNewPanel}
        existingCategories={existingCategories}
      />

      {/* Modal para crear una nueva categoría */}
      <Modal
        open={newCatModalOpen}
        onClose={() => setNewCatModalOpen(false)}
        title="Añadir nueva categoría"
      >
        <form onSubmit={handleCreateNewCategory} className="space-y-4">
          <p className="text-xs text-slate-400">
            Escribe el nombre de la nueva categoría o sistema (ej: <em>Facturación, Tokio, Marketing, Servidores</em>). Al crearla, podrás añadir paneles directamente a ella.
          </p>
          <Field label="Nombre de la categoría:">
            <Input
              required
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Ej: Facturación, Tokio, Servidores..."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setNewCatModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Crear categoría y añadir panel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal para renombrar / editar una categoría existente */}
      <Modal
        open={!!renamingCategory}
        onClose={() => setRenamingCategory(null)}
        title={`Renombrar categoría «${renamingCategory?.oldName}»`}
      >
        <form onSubmit={handleRenameCategory} className="space-y-4">
          <p className="text-xs text-slate-400">
            Introduce el nuevo nombre para la categoría <strong>«{renamingCategory?.oldName}»</strong>. Todos los paneles que pertenezcan a esta categoría se actualizarán automáticamente.
          </p>
          <Field label="Nuevo nombre de la categoría:">
            <Input
              required
              autoFocus
              value={renamingCategory?.newName || ''}
              onChange={(e) =>
                setRenamingCategory((prev) => (prev ? { ...prev, newName: e.target.value } : null))
              }
              placeholder="Nuevo nombre..."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setRenamingCategory(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Guardar cambios
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal para cambiar la categoría personal de un panel compartido */}
      <Modal
        open={!!editingCustomCategory}
        onClose={() => setEditingCustomCategory(null)}
        title="Cambiar mi categoría personal"
      >
        <form onSubmit={onSaveCustomCategory} className="space-y-4">
          <Field label="Categoría / Sistema para este panel compartido:">
            <Input
              required
              list="dash-cat-list"
              value={editingCustomCategory?.category || ''}
              onChange={(e) =>
                setEditingCustomCategory((prev) => (prev ? { ...prev, category: e.target.value } : null))
              }
              placeholder="Ej: Facturación, Marketing, Sistemas..."
            />
            <datalist id="dash-cat-list">
              {existingCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setEditingCustomCategory(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Guardar categoría
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal para aceptar invitación con categoría */}
      <Modal
        open={!!acceptingShare}
        onClose={() => setAcceptingShare(null)}
        title="Aceptar panel compartido"
      >
        <form onSubmit={onAcceptPendingShare} className="space-y-4">
          <p className="text-xs text-slate-300">
            Panel: <span className="font-semibold">{acceptingShare?.panel?.name}</span>
          </p>
          <Field label="Elige en qué categoría / sistema quieres organizarlo:">
            <Input
              required
              value={acceptCategory}
              onChange={(e) => setAcceptCategory(e.target.value)}
              placeholder="Ej: Facturación, Sistemas, Compartidos..."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setAcceptingShare(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Aceptar e incorporar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
