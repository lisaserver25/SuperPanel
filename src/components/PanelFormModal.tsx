import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Share2, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Field, Input, Modal, Select } from './ui'
import {
  fetchAcceptedCollaborators,
  fetchCredentials,
  fetchHistoricalSharedUsers,
  fetchPanelShares,
  removePanelShare,
  savePanel,
  sharePanel,
  updatePanelShareCategory,
  upsertCredential,
} from '../lib/queries'
import {
  getPanelEmbedPreference,
  savePanelEmbedPreference,
  saveUserCustomCategory,
} from '../lib/categories'
import { useAuth } from '../lib/auth'
import type { Panel, PanelCredential, PanelShare } from '../lib/types'

interface FormState {
  id?: string
  name: string
  url: string
  category: string
  logo_url: string
  sort_order: string
  notes: string
  embed_mode: 'frame' | 'launcher'
  // Datos de autenticación integrados
  auth_username: string
  auth_password: string
  existing_cred_id?: string
}

const emptyForm: FormState = {
  name: '',
  url: 'https://',
  category: 'General',
  logo_url: '',
  sort_order: '0',
  notes: '',
  embed_mode: 'frame',
  auth_username: '',
  auth_password: '',
  existing_cred_id: undefined,
}

function fromPanel(p: Panel, userId?: string, existingCred?: PanelCredential | null): FormState {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    category: p.category || 'General',
    logo_url: p.logo_url ?? '',
    sort_order: String(p.sort_order),
    notes: p.notes ?? '',
    embed_mode: getPanelEmbedPreference(userId, p.id, p.kind),
    auth_username: existingCred?.username ?? '',
    auth_password: '',
    existing_cred_id: existingCred?.id,
  }
}

export default function PanelFormModal({
  open,
  onClose,
  initial,
  defaultCategory,
  existingCategories = [],
}: {
  open: boolean
  onClose: () => void
  initial: Panel | null
  defaultCategory?: string
  existingCategories?: string[]
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Gestión de colaboradores y usuarios históricos
  const [shareEmail, setShareEmail] = useState('')
  const [selectedCollabs, setSelectedCollabs] = useState<string[]>([])
  const [sharesToDelete, setSharesToDelete] = useState<string[]>([])

  const collabsQuery = useQuery({
    queryKey: ['accepted-collaborators'],
    queryFn: fetchAcceptedCollaborators,
    enabled: open,
  })

  const historicalUsersQuery = useQuery({
    queryKey: ['historical-shared-users'],
    queryFn: fetchHistoricalSharedUsers,
    enabled: open,
  })

  const currentSharesQuery = useQuery({
    queryKey: ['panel-shares', initial?.id],
    queryFn: () => fetchPanelShares(initial!.id),
    enabled: open && !!initial?.id,
  })

  const credsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: fetchCredentials,
    enabled: open,
  })

  const collaborators = collabsQuery.data ?? []
  const historicalUsers = historicalUsersQuery.data ?? []
  const existingShares: PanelShare[] = currentSharesQuery.data ?? []
  const allCredentials = credsQuery.data ?? []

  // Combinar usuarios históricos y colaboradores excluyendo el propio email
  const availableShareUsers = useMemo(() => {
    const map = new Map<string, { email: string; label: string }>()
    const myEmail = (user?.email || '').toLowerCase()

    for (const c of collaborators) {
      const em = c.email.toLowerCase()
      if (em !== myEmail) {
        map.set(em, { email: c.email, label: c.name ? `${c.name} (${c.email})` : c.email })
      }
    }

    for (const h of historicalUsers) {
      const em = h.email.toLowerCase()
      if (em !== myEmail && !map.has(em)) {
        map.set(em, { email: h.email, label: h.name ? `${h.name} (${h.email})` : h.email })
      }
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [collaborators, historicalUsers, user?.email])

  const panelCred = useMemo(() => {
    if (!initial?.id) return null
    return allCredentials.find((c) => c.panel_id === initial.id) ?? null
  }, [initial?.id, allCredentials])

  // Categorías disponibles para elegir
  const categoryList = useMemo(() => {
    const set = new Set<string>(existingCategories)
    if (set.size === 0) set.add('General')
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [existingCategories])

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm(fromPanel(initial, user?.id, panelCred))
      } else {
        setForm({
          ...emptyForm,
          category: defaultCategory || 'General',
        })
      }
      setError('')
      setShareEmail('')
      setSelectedCollabs([])
      setSharesToDelete([])
    }
  }, [open, initial, defaultCategory, panelCred, user?.id])

  const activeExistingShares = useMemo(() => {
    return existingShares.filter((s) => !sharesToDelete.includes(s.id))
  }, [existingShares, sharesToDelete])


  function handleSelectHistoricalUser(email: string) {
    if (!email) return
    const norm = email.trim().toLowerCase()
    if (activeExistingShares.some((s) => s.shared_with_email.toLowerCase() === norm)) {
      setError('Este panel ya está compartido con este correo')
      return
    }
    if (!selectedCollabs.includes(norm)) {
      setSelectedCollabs((prev) => [...prev, norm])
    }
    setError('')
  }

  function addShareEmail() {
    const trimmed = shareEmail.trim().toLowerCase()
    if (!trimmed) return
    if (!trimmed.includes('@')) {
      setError('Introduce un correo electrónico válido')
      return
    }
    if (activeExistingShares.some((s) => s.shared_with_email.toLowerCase() === trimmed)) {
      setError('Este panel ya está compartido con este correo')
      return
    }
    if (!selectedCollabs.includes(trimmed)) {
      setSelectedCollabs((prev) => [...prev, trimmed])
    }
    setShareEmail('')
    setError('')
  }

  function markShareForRemoval(shareId: string) {
    setSharesToDelete((prev) => [...prev, shareId])
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      new URL(form.url)
    } catch {
      setError('La URL del panel no es válida (ej: https://ejemplo.com)')
      return
    }

    setSaving(true)
    setError('')
    try {
      const catToSave = form.category.trim() || 'General'

      // Guardar categoría en categorías personalizadas del usuario
      saveUserCustomCategory(user?.id, catToSave)

      let panelId = form.id

      // Si es un panel compartido, actualizar la categoría asignada por este usuario
      if (initial?.is_shared && initial?.share_id) {
        await updatePanelShareCategory(initial.share_id, catToSave)
        panelId = initial.id
      } else {
        // 1. Guardar panel propio (siempre como 'third')
        panelId = await savePanel({
          id: form.id,
          name: form.name.trim(),
          url: form.url.trim(),
          kind: 'third',
          category: catToSave,
          logo_url: form.logo_url.trim() || null,
          notes: form.notes.trim() || null,
          sort_order: Number.parseInt(form.sort_order || '0', 10) || 0,
          supabase_url: null,
          supabase_anon_key: null,
        })
      }

      // Guardar preferencia de visualización (Marco embebido vs Acceso directo)
      if (panelId) {
        savePanelEmbedPreference(user?.id, panelId, form.embed_mode)
      }

      // 2. Guardar o actualizar credenciales cifradas si se introdujo usuario
      if (form.auth_username.trim()) {
        await upsertCredential({
          id: form.existing_cred_id,
          panel_id: panelId,
          label: 'Acceso principal',
          username: form.auth_username.trim(),
          password: form.auth_password || undefined,
        }).catch(() => {
          /* error silencioso sin exponer credencial a consola */
        })
      }

      // 3. Procesar eliminaciones de compartición
      for (const shareId of sharesToDelete) {
        await removePanelShare(shareId).catch(() => {})
      }

      // 4. Procesar nuevas comparticiones seleccionadas
      for (const email of selectedCollabs) {
        await sharePanel(panelId, email).catch(() => {})
      }

      onClose()
      await qc.invalidateQueries({ queryKey: ['panels'] })
      await qc.invalidateQueries({ queryKey: ['credentials'] })
      await qc.invalidateQueries({ queryKey: ['panel-shares'] })
      await qc.invalidateQueries({ queryKey: ['historical-shared-users'] })
      await qc.invalidateQueries({ queryKey: ['collaborations'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el panel')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Editar panel' : 'Añadir panel'} maxWidth="max-w-xl">
      <form className="space-y-3 text-xs" onSubmit={onSubmit}>
        {/* Fila 1: Nombre y Orden */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_80px]">
          <Field label="Nombre del panel">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: OneProvider, Tokio, Servidor 1..."
              className="py-1.5 text-xs"
            />
          </Field>
          <Field label="Orden">
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              className="py-1.5 text-xs text-center"
            />
          </Field>
        </div>

        {/* Fila 2: URL y Modo de apertura */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="URL del panel / sitio web">
            <Input
              required
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://oneprovider.com"
              className="py-1.5 text-xs font-mono"
            />
          </Field>

          <Field label="Modo de apertura">
            <Select
              value={form.embed_mode}
              onChange={(e) => setForm((f) => ({ ...f, embed_mode: e.target.value as 'frame' | 'launcher' }))}
              className="py-1.5 text-xs"
            >
              <option value="frame">Marco embebido (Iframe interno)</option>
              <option value="launcher">Acceso directo (Lanzador con credenciales)</option>
            </Select>
          </Field>
        </div>

        {/* Fila 3: Categoría personalizada compacta */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-1.5">
          <Field label="Categoría personalizada:">
            <Input
              required
              list="cat-datalist-modal"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Escribe el nombre de tu categoría (ej: Tokio, Datacenter...)"
              className="py-1 text-xs"
            />
            <datalist id="cat-datalist-modal">
              {categoryList.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>

          {categoryList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 max-h-16 overflow-y-auto pt-0.5">
              <span className="text-[10px] text-slate-500 mr-1">Rápidas:</span>
              {categoryList.map((cat) => {
                const isSelected = form.category.trim().toLowerCase() === cat.toLowerCase()
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: cat }))}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                      isSelected
                        ? 'bg-sky-500 text-white font-medium shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Fila 4: Acceso & Credenciales Cifradas Compactas */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <KeyRound size={14} className="text-emerald-400" />
              <span className="text-xs font-semibold text-slate-200">Acceso & Credenciales cifradas</span>
            </div>
            <span className="text-[10px] text-emerald-400/80">Cifrado seguro</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Usuario (email o login)">
              <Input
                value={form.auth_username}
                onChange={(e) => setForm((f) => ({ ...f, auth_username: e.target.value }))}
                placeholder="admin@panel.com"
                autoComplete="off"
                className="py-1 text-xs"
              />
            </Field>

            <Field label={form.existing_cred_id ? 'Contraseña (dejar vacío para mantener)' : 'Contraseña'}>
              <div className="relative">
                <Input
                  type="password"
                  value={form.auth_password}
                  onChange={(e) => setForm((f) => ({ ...f, auth_password: e.target.value }))}
                  placeholder={form.existing_cred_id ? '•••••••• (sin cambios)' : '••••••••'}
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  className="py-1 pr-7 text-xs"
                />
                <Lock size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </Field>
          </div>
        </div>

        {/* Fila 5: Logo URL y Notas internas */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="Logo URL (opcional)">
            <Input
              value={form.logo_url}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              placeholder="Vacío = se detecta del dominio"
              className="py-1 text-xs"
            />
            <span className="block pt-0.5 text-[10px] text-slate-500">
              Si lo dejas vacío se obtiene automáticamente y se guarda para el resto de usuarios.
            </span>
          </Field>
          <Field label="Notas internas (opcional)">
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Observaciones del panel..."
              className="py-1 text-xs"
            />
          </Field>
        </div>

        {/* Fila 6: Compartición con otros usuarios + Desplegable histórico */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Share2 size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-slate-200">Compartir con otros usuarios</span>
            </div>
            {activeExistingShares.length > 0 && (
              <span className="text-[10px] text-slate-400">{activeExistingShares.length} compartido(s)</span>
            )}
          </div>

          {/* Desplegable de usuarios frecuentes / históricos */}
          {availableShareUsers.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] text-slate-400">Usuarios con los que ya has compartido:</span>
              <Select
                value=""
                onChange={(e) => handleSelectHistoricalUser(e.target.value)}
                className="py-1 text-xs"
              >
                <option value="">▼ Selecciona un usuario frecuente para invitarlo...</option>
                {availableShareUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Invitar por correo directo */}
          <div className="flex items-center gap-1.5">
            <Input
              type="email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addShareEmail()
                }
              }}
              placeholder="Escribe otro correo electrónico para invitar…"
              className="py-1 text-xs"
            />
            <Button type="button" onClick={addShareEmail} className="shrink-0 px-2.5 py-1 text-xs">
              <UserPlus size={13} /> Añadir
            </Button>
          </div>

          {/* Nuevas invitaciones seleccionadas */}
          {selectedCollabs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[10px] text-sky-400 mr-1">Se invitará:</span>
              {selectedCollabs.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded bg-sky-950/80 px-2 py-0.5 text-[11px] text-sky-300 border border-sky-800/80"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => setSelectedCollabs((prev) => prev.filter((e) => e !== email))}
                    className="text-sky-400 hover:text-red-400 font-bold ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Accesos compartidos actuales con revocar */}
          {activeExistingShares.length > 0 && (
            <div className="space-y-1 pt-1.5 border-t border-slate-800/80">
              <ul className="divide-y divide-slate-800/60 rounded border border-slate-800 bg-slate-950/40">
                {activeExistingShares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-2.5 py-1 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0 pr-2">
                      <Users size={12} className="text-slate-400 shrink-0" />
                      <span className="font-mono text-slate-200 truncate">{s.shared_with_email}</span>
                      <Badge tone={s.status === 'accepted' ? 'green' : 'slate'}>
                        {s.status === 'accepted' ? 'Aceptada' : 'Pendiente'}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      className="px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300 shrink-0"
                      title="Revocar acceso"
                      onClick={() => markShareForRemoval(s.id)}
                    >
                      <Trash2 size={11} /> Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Botones de acción */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <Button type="button" onClick={onClose} className="px-3 py-1 text-xs">
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={saving} className="px-3.5 py-1 text-xs">
            {saving ? 'Guardando…' : 'Guardar panel'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
