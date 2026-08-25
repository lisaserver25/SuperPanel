import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Share2, Trash2, UserCheck, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Field, Input, Modal, Select } from './ui'
import {
  fetchAcceptedCollaborators,
  fetchCredentials,
  fetchPanelShares,
  removePanelShare,
  savePanel,
  sharePanel,
  upsertCredential,
} from '../lib/queries'
import type { Panel, PanelCredential, PanelKind, PanelShare } from '../lib/types'

interface FormState {
  id?: string
  name: string
  url: string
  kind: PanelKind
  category: string
  logo_url: string
  sort_order: string
  notes: string
  supabase_url: string
  supabase_anon_key: string
  // Datos de autenticación integrados
  auth_username: string
  auth_password: string
  existing_cred_id?: string
}

const emptyForm: FormState = {
  name: '',
  url: 'https://',
  kind: 'own',
  category: 'General',
  logo_url: '',
  sort_order: '0',
  notes: '',
  supabase_url: 'https://',
  supabase_anon_key: '',
  auth_username: '',
  auth_password: '',
  existing_cred_id: undefined,
}

const DEFAULT_CATEGORY_SUGGESTIONS = [
  'General',
  'Sistemas',
  'Facturación',
  'Marketing',
  'CRM & Clientes',
  'Operaciones',
  'Desarrollo',
  'Analítica',
]

function fromPanel(p: Panel, existingCred?: PanelCredential | null): FormState {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    kind: p.kind,
    category: p.category || 'General',
    logo_url: p.logo_url ?? '',
    sort_order: String(p.sort_order),
    notes: p.notes ?? '',
    supabase_url: p.supabase_url ?? 'https://',
    supabase_anon_key: p.supabase_anon_key ?? '',
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
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Gestión de colaboradores
  const [shareEmail, setShareEmail] = useState('')
  const [selectedCollabs, setSelectedCollabs] = useState<string[]>([])
  const [sharesToDelete, setSharesToDelete] = useState<string[]>([])

  const collabsQuery = useQuery({
    queryKey: ['accepted-collaborators'],
    queryFn: fetchAcceptedCollaborators,
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
  const existingShares: PanelShare[] = currentSharesQuery.data ?? []
  const allCredentials = credsQuery.data ?? []

  const panelCred = useMemo(() => {
    if (!initial?.id) return null
    return allCredentials.find((c) => c.panel_id === initial.id) ?? null
  }, [initial?.id, allCredentials])

  const allCategorySuggestions = useMemo(() => {
    return Array.from(new Set([...existingCategories, ...DEFAULT_CATEGORY_SUGGESTIONS])).filter(Boolean)
  }, [existingCategories])

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm(fromPanel(initial, panelCred))
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
  }, [open, initial, defaultCategory, panelCred])

  const activeExistingShares = useMemo(() => {
    return existingShares.filter((s) => !sharesToDelete.includes(s.id))
  }, [existingShares, sharesToDelete])

  function toggleCollab(email: string) {
    const norm = email.toLowerCase()
    setSelectedCollabs((prev) =>
      prev.includes(norm) ? prev.filter((e) => e !== norm) : [...prev, norm]
    )
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
    if (form.kind === 'own') {
      try {
        new URL(form.supabase_url)
      } catch {
        setError('La URL de Supabase no es válida')
        return
      }
      if (!form.supabase_anon_key.trim()) {
        setError('Falta la clave anon del Supabase del panel (es pública, la encuentras en Settings → API)')
        return
      }
    }

    setSaving(true)
    setError('')
    try {
      // 1. Guardar panel
      const panelId = await savePanel({
        id: form.id,
        name: form.name.trim(),
        url: form.url.trim(),
        kind: form.kind,
        category: form.category.trim() || 'General',
        logo_url: form.logo_url.trim() || null,
        notes: form.notes.trim() || null,
        sort_order: Number.parseInt(form.sort_order || '0', 10) || 0,
        supabase_url: form.kind === 'own' ? form.supabase_url.trim() : null,
        supabase_anon_key: form.kind === 'own' ? form.supabase_anon_key.trim() : null,
      })

      // 2. Guardar o actualizar credenciales cifradas si se introdujo usuario
      if (form.auth_username.trim()) {
        await upsertCredential({
          id: form.existing_cred_id,
          panel_id: panelId,
          label: 'Acceso principal',
          username: form.auth_username.trim(),
          password: form.auth_password || undefined,
        }).catch((err) => {
          console.warn('Error al guardar credencial integrada:', err)
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
      await qc.invalidateQueries({ queryKey: ['collaborations'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el panel')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Editar panel' : 'Añadir panel'}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre del panel">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Gestlisa, Tokyo, Admin..."
            />
          </Field>
          <Field label="Tipo de panel">
            <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PanelKind }))}>
              <option value="own">Propio (auto-login con puente Supabase)</option>
              <option value="third">Tercero / Externo (OneProvider, AWS, etc.)</option>
            </Select>
          </Field>
        </div>

        {form.kind === 'third' && (
          <p className="text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg p-2">
            💡 <strong>Panel externo:</strong> Los sitios de terceros que bloqueen iframes por seguridad (como OneProvider)
            podrán abrirse con 1 clic en <em>Pestaña nueva</em> con tus credenciales cifradas listas para copiar.
          </p>
        )}

        {/* Categoría / Sistema con chips rápidos y escritura libre */}
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <Field label="Categoría / Sistema del panel">
            <Input
              required
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Escribe una categoría nueva o selecciona una abajo…"
            />
          </Field>

          <div>
            <span className="text-[11px] font-medium text-slate-400">Sugerencias y categorías existentes:</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {allCategorySuggestions.map((cat) => {
                const isSelected = form.category.trim().toLowerCase() === cat.toLowerCase()
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: cat }))}
                    className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                      isSelected
                        ? 'bg-sky-500 text-white font-medium shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Acceso y Autenticación Integrada (Usuario y Contraseña) */}
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-emerald-400" />
            <span className="text-sm font-semibold text-slate-200">Acceso & Autenticación del panel</span>
          </div>
          <p className="text-xs text-slate-400">
            Guarda el usuario y contraseña del panel. Se almacenarán **cifrados de forma segura** y se utilizarán
            automáticamente al abrir el panel o compartirlo con otros usuarios sin tener que recordar la contraseña.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Usuario (email o login del panel)">
              <Input
                value={form.auth_username}
                onChange={(e) => setForm((f) => ({ ...f, auth_username: e.target.value }))}
                placeholder="admin@panel.com"
                autoComplete="off"
              />
            </Field>

            <Field label={form.existing_cred_id ? 'Contraseña (oculta / dejar vacío para mantener)' : 'Contraseña'}>
              <div className="relative">
                <Input
                  type="password"
                  value={form.auth_password}
                  onChange={(e) => setForm((f) => ({ ...f, auth_password: e.target.value }))}
                  placeholder={form.existing_cred_id ? '•••••••• (sin cambios)' : '••••••••'}
                  autoComplete="new-password"
                />
                <Lock size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
          <Field label="URL del panel">
            <Input
              required
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://tu-panel.com"
            />
          </Field>
          <Field label="Orden">
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
            />
          </Field>
        </div>

        {form.kind === 'own' && (
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-sky-400">Configuración de auto-login (Supabase del panel)</p>
            <Field label="Supabase URL del panel">
              <Input
                required
                value={form.supabase_url}
                onChange={(e) => setForm((f) => ({ ...f, supabase_url: e.target.value }))}
                placeholder="https://xxxx.supabase.co"
              />
            </Field>
            <Field label="Supabase anon key del panel (clave pública)">
              <Input
                required
                value={form.supabase_anon_key}
                onChange={(e) => setForm((f) => ({ ...f, supabase_anon_key: e.target.value }))}
                className="font-mono text-xs"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Logo URL (opcional)">
            <Input
              value={form.logo_url}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://.../logo.png"
            />
          </Field>
          <Field label="Notas internas (opcional)">
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Observaciones..."
            />
          </Field>
        </div>

        {/* Sección de Compartición con otros usuarios */}
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-sky-400" />
            <span className="text-sm font-semibold text-slate-200">Compartir panel con otros usuarios</span>
          </div>
          <p className="text-xs text-slate-400">
            Los usuarios invitados recibirán una invitación para aceptar el panel en su propia categoría y podrán
            utilizar los mismos accesos configurados.
          </p>

          {/* Colaboradores conectados rápidos */}
          {collaborators.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Seleccionar de tus colaboradores:</span>
              <div className="flex flex-wrap gap-2">
                {collaborators.map((c) => {
                  const isAlreadyShared = activeExistingShares.some(
                    (s) => s.shared_with_email.toLowerCase() === c.email.toLowerCase()
                  )
                  const isSelected = selectedCollabs.includes(c.email.toLowerCase())
                  if (isAlreadyShared) return null

                  return (
                    <button
                      key={c.email}
                      type="button"
                      onClick={() => toggleCollab(c.email)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        isSelected
                          ? 'border-sky-500 bg-sky-500/20 text-sky-200'
                          : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {isSelected ? <UserCheck size={13} /> : <UserPlus size={13} />}
                      <span>{c.name ? `${c.name} (${c.email})` : c.email}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Invitar por correo directo */}
          <div className="flex items-center gap-2">
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
              placeholder="correo-usuario@empresa.com"
              className="text-xs"
            />
            <Button type="button" onClick={addShareEmail} className="shrink-0 text-xs">
              <UserPlus size={13} /> Añadir
            </Button>
          </div>

          {/* Nuevas invitaciones preparadas para enviar */}
          {selectedCollabs.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-sky-400">Se invitará al guardar:</span>
              <div className="flex flex-wrap gap-1.5">
                {selectedCollabs.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-md bg-sky-950 px-2 py-0.5 text-xs text-sky-300 border border-sky-800"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => setSelectedCollabs((prev) => prev.filter((e) => e !== email))}
                      className="text-sky-400 hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Comparticiones activas con opción de revocar */}
          {activeExistingShares.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <span className="text-xs font-medium text-slate-300">Accesos compartidos actuales:</span>
              <ul className="divide-y divide-slate-800/80 rounded-md border border-slate-800 bg-slate-950/50">
                {activeExistingShares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Users size={13} className="text-slate-400" />
                      <span className="font-mono text-slate-200">{s.shared_with_email}</span>
                      <Badge tone={s.status === 'accepted' ? 'green' : 'slate'}>
                        {s.status === 'accepted' ? 'Aceptada' : 'Pendiente'}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      className="px-1.5 py-0.5 text-red-400 hover:text-red-300"
                      title="Revocar acceso"
                      onClick={() => markShareForRemoval(s.id)}
                    >
                      <Trash2 size={12} /> Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar panel'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
