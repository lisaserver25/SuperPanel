import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ChevronDown,
  ExternalLink,
  FileUp,
  Folder,
  FolderEdit,
  FolderPlus,
  KeyRound,
  Layers,
  LayoutGrid,
  List,
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
import {
  getUserCustomCategories,
  removeUserCustomCategory,
  renameUserCustomCategory,
  saveUserCustomCategory,
} from '../lib/categories'
import { useAuth } from '../lib/auth'
import { Badge, Button, EmptyState, Field, Input, Modal } from '../components/ui'
import { useTabs } from '../lib/tabs'
import PanelFormModal from '../components/PanelFormModal'
import ImporterModal from '../components/ImporterModal'
import type { Panel, PanelShare } from '../lib/types'

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function emailPrefix(email: string): string {
  const [local] = email.split('@')
  return local.length > 14 ? `${local.slice(0, 13)}…` : local
}

export default function Dashboard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { openPanelTab } = useTabs()
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('all')
  // Categorías expandidas (por defecto todas colapsadas)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      return (localStorage.getItem('sp_view_mode') as 'list' | 'grid') || 'list'
    } catch {
      return 'list'
    }
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Panel | null>(null)
  const [targetCatForNewPanel, setTargetCatForNewPanel] = useState<string>('General')
  const [importerOpen, setImporterOpen] = useState(false)
  const [importerCategory, setImporterCategory] = useState('Plex')
  const [error, setError] = useState('')

  function handleSetViewMode(mode: 'list' | 'grid') {
    setViewMode(mode)
    try {
      localStorage.setItem('sp_view_mode', mode)
    } catch {
      /* ignore */
    }
  }

  // Versión local para forzar actualización de categorías
  const [catVersion, setCatVersion] = useState(0)

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

  // Todas las categorías existentes (paneles + categorías personalizadas del usuario)
  const allCategories = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    catVersion
    const set = new Set<string>()
    for (const p of panels) {
      if (p.category) set.add(p.category)
    }
    const stored = getUserCustomCategories(user?.id)
    for (const c of stored) {
      if (c.trim()) set.add(c.trim())
    }
    if (set.size === 0) set.add('General')
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [panels, user?.id, catVersion])

  // Categorías visibles en el filtro superior: solo las que tienen paneles, o la seleccionada actualmente
  const filterCategories = useMemo(() => {
    return allCategories.filter((cat) => {
      const count = panels.filter((p) => (p.category || 'General') === cat).length
      return count > 0 || selectedCategory === cat
    })
  }, [allCategories, panels, selectedCategory])

  // Subservicios existentes en los paneles (para el filtro)
  const allSubcategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of panels) {
      const sub = p.subcategory?.trim()
      if (sub && sub !== 'General') set.add(sub)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [panels])

  // Filtrado de paneles
  const visiblePanels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return panels.filter((p) => {
      const panelCat = p.category || 'General'
      if (selectedCategory !== 'all' && panelCat !== selectedCategory) return false

      if (selectedSubcategory !== 'all' && (p.subcategory || 'General') !== selectedSubcategory) return false

      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.url.toLowerCase().includes(q) ||
        panelCat.toLowerCase().includes(q) ||
        (p.subcategory || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      )
    })
  }, [panels, selectedCategory, selectedSubcategory, search])

  // Agrupación por categoría (ocultando categorías vacías en la vista general y al buscar)
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, Panel[]> = {}
    
    // Si estamos filtrando por una categoría concreta o viendo todas
    const targetCategories = selectedCategory !== 'all' ? [selectedCategory] : allCategories

    for (const cat of targetCategories) {
      groups[cat] = []
    }

    for (const p of visiblePanels) {
      const cat = p.category || 'General'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    }

    // Si estamos viendo "Todas" o realizando una búsqueda (o filtrando por subservicio), ocultar categorías vacías
    if (selectedCategory === 'all' || search.trim() || selectedSubcategory !== 'all') {
      return Object.entries(groups)
        .filter(([, catPanels]) => catPanels.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    }

    // Si se seleccionó una categoría específica, mantenerla visible para poder gestionarla
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [visiblePanels, allCategories, selectedCategory, selectedSubcategory, search])

  function toggleCatExpanded(category: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }
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

  function handleCreateCategoryOnly(e: FormEvent) {
    e.preventDefault()
    const cat = newCatName.trim()
    if (!cat) return
    saveUserCustomCategory(user?.id, cat)
    setCatVersion((v) => v + 1)
    setNewCatModalOpen(false)
    setNewCatName('')
    setSelectedCategory(cat)
  }

  function handleCreateCategoryAndOpenPanel() {
    const cat = newCatName.trim()
    if (!cat) return
    saveUserCustomCategory(user?.id, cat)
    setCatVersion((v) => v + 1)
    setNewCatModalOpen(false)
    setNewCatName('')
    openCreate(cat)
  }

  async function handleRenameCategory(e: FormEvent) {
    e.preventDefault()
    if (!renamingCategory) return
    const { oldName, newName } = renamingCategory
    const trimmedNew = newName.trim()
    if (!trimmedNew) return

    setError('')
    try {
      renameUserCustomCategory(user?.id, oldName, trimmedNew)
      setCatVersion((v) => v + 1)
      await renameCategory(oldName, trimmedNew)
      setRenamingCategory(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      if (selectedCategory === oldName) {
        setSelectedCategory(trimmedNew)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renombrar la categoría')
    }
  }

  async function handleDeleteCategory(categoryName: string) {
    const catPanels = panels.filter((p) => (p.category || 'General') === categoryName)
    if (catPanels.length > 0) {
      if (!window.confirm(`La categoría «${categoryName}» contiene ${catPanels.length} paneles. ¿Eliminar esta categoría y mover sus paneles a «General»?`)) return
      try {
        await renameCategory(categoryName, 'General')
        await qc.invalidateQueries({ queryKey: ['panels'] })
      } catch {
        /* ignore */
      }
    } else {
      if (!window.confirm(`¿Eliminar la categoría «${categoryName}»?`)) return
    }

    removeUserCustomCategory(user?.id, categoryName)
    setCatVersion((v) => v + 1)
    if (selectedCategory === categoryName) {
      setSelectedCategory('all')
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
      const cat = acceptCategory.trim() || 'General'
      saveUserCustomCategory(user?.id, cat)
      setCatVersion((v) => v + 1)
      await respondPanelShare(acceptingShare.id, true, cat)
      setAcceptingShare(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
      await qc.invalidateQueries({ queryKey: ['pending-panel-shares'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    }
  }

  async function handleRejectShare(shareId: string) {
    setError('')
    try {
      await respondPanelShare(shareId, false)
      await qc.invalidateQueries({ queryKey: ['pending-panel-shares'] })
      await qc.invalidateQueries({ queryKey: ['panels'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar la invitación')
    }
  }

  async function onSaveCustomCategory(e: FormEvent) {
    e.preventDefault()
    if (!editingCustomCategory) return
    setError('')
    try {
      const cat = editingCustomCategory.category.trim() || 'General'
      saveUserCustomCategory(user?.id, cat)
      setCatVersion((v) => v + 1)
      await updatePanelShareCategory(editingCustomCategory.shareId, cat)
      setEditingCustomCategory(null)
      await qc.invalidateQueries({ queryKey: ['panels'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la categoría')
    }
  }

  function renderListRow(p: Panel) {
    return (
      <div
        key={p.id}
        className="group flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-900/40 hover:bg-slate-900/90 p-3 sm:px-4 transition-all hover:border-sky-500/50 hover:shadow-md hover:shadow-sky-950/20"
      >
        <div className="flex min-w-0 items-center gap-3.5 flex-1">
          <div
            onClick={() => openPanelTab(p)}
            className="cursor-pointer shrink-0"
            title="Abrir en pestaña"
          >
            {p.logo_url ? (
              <img
                src={p.logo_url}
                alt=""
                className="h-10 w-10 rounded-lg bg-slate-800 object-cover ring-1 ring-slate-700/50"
              />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-800 font-bold text-slate-300 ring-1 ring-slate-700/50 group-hover:text-sky-400">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openPanelTab(p)}
                className="text-left font-semibold text-slate-100 hover:text-sky-300 transition-colors truncate max-w-xs sm:max-w-md"
                title="Abrir en pestaña"
              >
                {p.name}
              </button>

              <Badge tone="slate">
                <Folder size={11} /> {p.category || 'General'}
              </Badge>

              {p.subcategory && p.subcategory !== 'General' && (
                <Badge tone="sky">
                  <Layers size={11} /> {p.subcategory}
                </Badge>
              )}

              {p.is_shared && (
                <Badge tone="violet">
                  <Users size={11} /> {p.shared_by_name ? `De ${p.shared_by_name.split(' ')[0]}` : 'Compartido'}
                </Badge>
              )}

              {credPanelIds.has(p.id) ? (
                <Badge tone="green">
                  <KeyRound size={11} /> Cuenta lista
                </Badge>
              ) : (
                <Badge tone="slate">
                  <KeyRound size={11} /> Sin credencial
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-sky-300 transition-colors truncate max-w-xs flex items-center gap-1 font-mono text-slate-400 hover:underline"
                title={`Abrir URL externa: ${p.url}`}
              >
                {hostname(p.url)}
              </a>

              {p.notes && (
                <span className="hidden sm:inline-block text-slate-400 italic truncate max-w-sm" title={p.notes}>
                  • {p.notes}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Columna: usuarios con los que se comparte este panel (solo paneles propios) */}
        {!p.is_shared && p.shared_with_users && p.shared_with_users.length > 0 && (
          <div className="hidden md:flex flex-col items-end gap-1 max-w-[240px] shrink-0">
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Share2 size={10} /> Compartido con
            </span>
            <div className="flex flex-wrap justify-end gap-1">
              {p.shared_with_users.map((u) => (
                <Badge key={u.email} tone={u.status === 'accepted' ? 'green' : 'slate'}>
                  {emailPrefix(u.email)}
                  {u.status === 'pending' ? ' ·' : ''}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0 self-end md:self-center pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/60 w-full md:w-auto justify-end">
          <Button
            variant="primary"
            className="px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm shadow-sky-500/20"
            onClick={() => openPanelTab(p)}
          >
            Abrir
          </Button>

          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost p-1.5 text-slate-400 hover:text-sky-300 transition-colors rounded-lg"
            title="Abrir en nueva ventana del navegador"
          >
            <ExternalLink size={15} />
          </a>

          {p.is_shared && p.share_id ? (
            <Button
              className="p-1.5 text-xs text-slate-300 hover:text-white"
              title="Cambiar categoría personal"
              onClick={() => setEditingCustomCategory({ shareId: p.share_id!, category: p.category })}
            >
              <FolderEdit size={14} />
            </Button>
          ) : (
            <Button
              className="p-1.5 text-xs text-slate-300 hover:text-white"
              title="Editar panel"
              onClick={() => openEdit(p)}
            >
              <Pencil size={14} />
            </Button>
          )}

          <Button
            className="p-1.5 text-xs text-slate-400 hover:text-red-400"
            title={p.is_shared ? 'Dejar de acceder a este panel compartido' : 'Eliminar panel'}
            onClick={() => onDelete(p)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    )
  }

  function renderGridCard(p: Panel) {
    return (
      <div
        key={p.id}
        className="card flex flex-col justify-between p-4 transition-all hover:border-sky-500/60 hover:shadow-lg hover:shadow-sky-950/30"
      >
        <div>
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

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="slate">
              <Folder size={11} /> {p.category || 'General'}
            </Badge>

            {p.subcategory && p.subcategory !== 'General' && (
              <Badge tone="sky">
                <Layers size={11} /> {p.subcategory}
              </Badge>
            )}

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

          {!p.is_shared && p.shared_with_users && p.shared_with_users.length > 0 && (
            <div
              className="mt-2 flex flex-wrap items-center gap-1"
              title={`Compartido con: ${p.shared_with_users.map((u) => `${u.email} (${u.status === 'accepted' ? 'aceptado' : 'pendiente'})`).join(', ')}`}
            >
              <Share2 size={11} className="text-slate-500 shrink-0" />
              {p.shared_with_users.map((u) => (
                <Badge key={u.email} tone={u.status === 'accepted' ? 'green' : 'slate'}>
                  {emailPrefix(u.email)}
                  {u.status === 'pending' ? ' ·' : ''}
                </Badge>
              ))}
            </div>
          )}

          {p.notes && (
            <p className="mt-2 text-xs text-slate-400 line-clamp-1 italic">
              {p.notes}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs">
          <Button
            variant="primary"
            className="px-2.5 py-1 text-xs"
            onClick={() => openPanelTab(p)}
          >
            Abrir
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
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4">
      {/* Encabezado y acciones principales */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tus Categorías & Paneles</h1>
          <p className="text-sm text-slate-400">
            Crea tus propias categorías personalizadas, organiza tus paneles y accede a ellos en pestañas
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Button
            onClick={() => {
              setNewCatName('')
              setNewCatModalOpen(true)
            }}
            className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
          >
            <FolderPlus size={15} className="text-sky-400" /> Añadir categoría
          </Button>
          <Button
            className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
            onClick={() => {
              setImporterCategory(selectedCategory !== 'all' ? selectedCategory : 'Plex')
              setImporterOpen(true)
            }}
            title="Importar muchos paneles de golpe desde un listado"
          >
            <FileUp size={15} className="text-emerald-400" /> Importar masivo
          </Button>
          <Button variant="primary" onClick={() => openCreate(selectedCategory !== 'all' ? selectedCategory : 'General')}>
            <Plus size={16} /> Añadir panel
          </Button>
        </div>
      </div>

      {/* Invitaciones de paneles pendientes (aceptar/rechazar en línea) */}
      {pendingShares.length > 0 && (
        <div className="space-y-2">
          {pendingShares.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/40 bg-sky-950/30 p-3.5 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Share2 className="shrink-0 text-sky-400" size={18} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-100">
                    «{s.panel?.name ?? 'Un panel'}» compartido contigo
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {s.shared_by_name ? `De: ${s.shared_by_name}. ` : ''}
                    Acéptalo para organizarlo en una de tus categorías.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs"
                  onClick={() => {
                    setAcceptCategory('General')
                    setAcceptingShare(s)
                  }}
                >
                  Aceptar
                </Button>
                <Button className="text-xs text-red-400" onClick={() => handleRejectShare(s.id)}>
                  Rechazar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Barra de búsqueda y selector de modo de vista */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por panel, URL o categoría…"
            className="pl-9 text-xs sm:text-sm"
          />
        </div>

        {/* Conmutador de vista Lista / Cuadrícula */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
          <button
            type="button"
            onClick={() => handleSetViewMode('list')}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              viewMode === 'list'
                ? 'bg-sky-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            )}
            title="Vista Lista"
          >
            <List size={14} />
            <span>Lista</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetViewMode('grid')}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              viewMode === 'grid'
                ? 'bg-sky-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            )}
            title="Vista Cuadrícula"
          >
            <LayoutGrid size={14} />
            <span>Cuadrícula</span>
          </button>
        </div>
      </div>

      {/* Píldoras de filtro por Categoría personal */}
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
        {filterCategories.map((cat) => {
          const count = panels.filter((p) => (p.category || 'General') === cat).length
          return (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat)
                // Al elegir una categoría concreta, se expande automáticamente
                setExpandedCats((prev) => new Set(prev).add(cat))
              }}
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

        <button
          onClick={() => {
            setNewCatName('')
            setNewCatModalOpen(true)
          }}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-sky-400 hover:text-sky-300 bg-sky-950/40 border border-sky-800/40 shrink-0"
          title="Crear nueva categoría"
        >
          <Plus size={12} /> Nueva categoría
        </button>
      </div>

      {/* Píldoras de filtro por Subservicio */}
      {allSubcategories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-xs font-semibold text-slate-500 mr-1 shrink-0">Subservicio:</span>
          <button
            onClick={() => setSelectedSubcategory('all')}
            className={clsx(
              'rounded-full px-3 py-1 text-xs transition-colors shrink-0',
              selectedSubcategory === 'all'
                ? 'bg-violet-500 text-white font-medium shadow-sm'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            )}
          >
            Todos
          </button>
          {allSubcategories.map((sub) => {
            const count = panels.filter((p) => (p.subcategory || 'General') === sub).length
            return (
              <button
                key={sub}
                onClick={() => setSelectedSubcategory(sub)}
                className={clsx(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors shrink-0',
                  selectedSubcategory === sub
                    ? 'bg-violet-500 text-white font-medium shadow-sm'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                )}
              >
                <Layers size={11} />
                <span>{sub}</span>
                <span className={selectedSubcategory === sub ? 'text-violet-100' : 'text-slate-500'}>({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Contenido principal de paneles */}
      {loading ? (
        <EmptyState>Cargando paneles y categorías…</EmptyState>
      ) : visiblePanels.length === 0 ? (
        <EmptyState>
          {panels.length === 0 && allCategories.length <= 1
            ? 'Todavía no has añadido ningún panel. Pulsa «Añadir categoría» o «Añadir panel» para comenzar.'
            : 'Ningún panel coincide con los filtros seleccionados.'}
        </EmptyState>
      ) : selectedCategory === 'all' ? (
        /* VISTA UNIFICADA SIN SEPARACIÓN POR CATEGORÍAS */
        viewMode === 'list' ? (
          <div className="space-y-2">
            {visiblePanels.map((p) => renderListRow(p))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visiblePanels.map((p) => renderGridCard(p))}
          </div>
        )
      ) : (
        /* VISTA POR CATEGORÍAS: cada una colapsada por defecto */
        <div className="space-y-4">
          {groupedByCategory.map(([category, catPanels]) => {
            const isExpanded =
              !!search.trim() || selectedSubcategory !== 'all' || expandedCats.has(category)
            return (
            <section key={category} className="rounded-xl border border-slate-800/80 bg-slate-900/30">
              {/* Cabecera de Categoría (clic = colapsar/expandir) */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleCatExpanded(category)}
                    className="grid h-7 w-7 place-items-center rounded bg-sky-500/10 text-sky-400 transition-colors hover:bg-sky-500/20"
                    title={isExpanded ? 'Colapsar categoría' : 'Expandir categoría'}
                  >
                    <ChevronDown size={15} className={clsx('transition-transform duration-200', isExpanded && 'rotate-180')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCatExpanded(category)}
                    className="flex min-w-0 items-center gap-2 text-left"
                    title={isExpanded ? 'Colapsar categoría' : `Mostrar los ${catPanels.length} paneles de «${category}»`}
                  >
                    <Folder size={15} className="shrink-0 text-sky-400" />
                    <h2 className="text-base font-semibold tracking-wide text-slate-100 truncate">
                      {category}
                    </h2>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400 font-mono shrink-0">
                      {catPanels.length} {catPanels.length === 1 ? 'panel' : 'paneles'}
                    </span>
                  </button>

                  {/* Botón para Renombrar Categoría */}
                  <button
                    type="button"
                    onClick={() => setRenamingCategory({ oldName: category, newName: category })}
                    className="p-1 text-slate-500 hover:text-sky-300 transition-colors"
                    title={`Editar nombre de la categoría «${category}»`}
                  >
                    <Pencil size={13} />
                  </button>

                  {/* Botón para Eliminar Categoría */}
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(category)}
                    className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                    title={`Eliminar categoría «${category}»`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    className="text-xs px-2.5 py-1 text-slate-300 hover:text-white border border-slate-800 bg-slate-900/60"
                    onClick={() => setRenamingCategory({ oldName: category, newName: category })}
                    title={`Editar nombre de la categoría «${category}»`}
                  >
                    <FolderEdit size={13} /> Renombrar
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

              {/* Contenido (solo si está expandida) */}
              {isExpanded &&
                (catPanels.length === 0 ? (
                <div className="mx-3 mb-3 rounded-xl border border-dashed border-slate-800 p-6 text-center bg-slate-950/30 space-y-3">
                  <p className="text-sm text-slate-400">
                    La categoría <strong>«{category}»</strong> no tiene paneles todavía.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="primary"
                      className="text-xs"
                      onClick={() => openCreate(category)}
                    >
                      <Plus size={14} /> Añadir panel a {category}
                    </Button>
                    <Button
                      className="text-xs text-red-400 hover:text-red-300 border border-slate-800"
                      onClick={() => handleDeleteCategory(category)}
                    >
                      <Trash2 size={13} /> Eliminar categoría
                    </Button>
                  </div>
                </div>
              ) : (
                (() => {
                  /* Sub-agrupación por subservicio dentro de la categoría */
                  const subGroups = new Map<string, Panel[]>()
                  for (const p of catPanels as Panel[]) {
                    const sub = p.subcategory && p.subcategory !== 'General' ? p.subcategory : 'General'
                    if (!subGroups.has(sub)) subGroups.set(sub, [])
                    subGroups.get(sub)!.push(p)
                  }
                  const groups = Array.from(subGroups.entries())
                  const hasMultiple = groups.length > 1 || (groups.length === 1 && groups[0][0] !== 'General')

                  if (!hasMultiple) {
                    return (
                      <div className="px-3 pb-3">
                        {viewMode === 'list' ? (
                          <div className="space-y-2">{catPanels.map((p: Panel) => renderListRow(p))}</div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {catPanels.map((p: Panel) => renderGridCard(p))}
                          </div>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="px-3 pb-3 space-y-4">
                      {groups.map(([sub, list]) => (
                        <div key={sub} className="space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            <Layers size={11} className="text-sky-400" />
                            {sub}
                            <span className="text-slate-600">({list.length})</span>
                          </div>
                          {viewMode === 'list' ? (
                            <div className="space-y-2">{list.map((p) => renderListRow(p))}</div>
                          ) : (
                            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {list.map((p) => renderGridCard(p))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })())}
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
        existingCategories={allCategories}
      />

      {/* Modal de importación masiva de paneles */}
      <ImporterModal
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        defaultCategory={importerCategory}
        existingCategories={allCategories}
      />

      {/* Modal para crear una nueva categoría directamente */}
      <Modal
        open={newCatModalOpen}
        onClose={() => setNewCatModalOpen(false)}
        title="Crear categoría personalizada"
      >
        <form onSubmit={handleCreateCategoryOnly} className="space-y-4">
          <p className="text-xs text-slate-400">
            Escribe el nombre personalizado que quieras darle a tu nueva categoría (por ejemplo:{' '}
            <strong>OneProvider</strong>, <strong>Tokio</strong>, <strong>Hosting</strong>, <strong>Facturación</strong>, etc.).
          </p>
          <Field label="Nombre de tu categoría:">
            <Input
              required
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Escribe el nombre aquí..."
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setNewCatModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200"
              onClick={handleCreateCategoryAndOpenPanel}
            >
              Crear y añadir panel
            </Button>
            <Button variant="primary" type="submit">
              Crear categoría
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
          <Field label="Categoría personalizada para este panel compartido:">
            <Input
              required
              list="dash-cat-list"
              value={editingCustomCategory?.category || ''}
              onChange={(e) =>
                setEditingCustomCategory((prev) => (prev ? { ...prev, category: e.target.value } : null))
              }
              placeholder="Ej: OneProvider, Tokio, Sistemas..."
            />
            <datalist id="dash-cat-list">
              {allCategories.map((c) => (
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
          <Field label="Elige o escribe tu categoría personal donde organizarlo:">
            <Input
              required
              list="accept-share-cat-list"
              value={acceptCategory}
              onChange={(e) => setAcceptCategory(e.target.value)}
              placeholder="Ej: Tokio, OneProvider, Sistemas..."
            />
            <datalist id="accept-share-cat-list">
              {allCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
