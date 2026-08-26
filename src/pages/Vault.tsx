import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, ClipboardCopy, Eye, EyeOff, Folder, KeyRound, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { deleteCredential, fetchCredentials, fetchPanels, revealCredential, upsertCredential } from '../lib/queries'
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

  const grouped = useMemo(() => {
    return panels
      .map((p) => ({ panel: p, creds: credentials.filter((c) => c.panel_id === p.id) }))
      .filter((g) => g.creds.length > 0)
  }, [panels, credentials])

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
      setForm(emptyForm)
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
    if (!window.confirm(`¿Eliminar la credencial «${c.label}»?`)) return
    try {
      await deleteCredential(c.id)
      await qc.invalidateQueries({ queryKey: ['credentials'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contraseñas</h1>
          <p className="text-sm text-slate-400">
            Cuentas de acceso de tus paneles, cifradas en el servidor (incluso para paneles compartidos)
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => openCreate(panels[0]?.id ?? '')} disabled={panels.length === 0}>
          <Plus size={16} /> Nueva credencial
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {panels.length === 0 && <EmptyState>No hay paneles dados de alta todavía.</EmptyState>}
      {panels.length > 0 && grouped.length === 0 && (
        <EmptyState>Todavía no has guardado credenciales. Añade la primera con «Nueva credencial».</EmptyState>
      )}

      <div className="space-y-5">
        {grouped.map(({ panel, creds }) => (
          <section key={panel.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-sm bg-slate-950/40">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-100">{panel.name}</span>
                <Badge tone="slate">
                  <Folder size={11} /> {panel.category || 'General'}
                </Badge>
                {panel.is_shared && (
                  <Badge tone="violet">
                    <Users size={11} /> Compartido por {panel.shared_by_name || 'otro usuario'}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-slate-500">{creds.length === 1 ? '1 cuenta' : `${creds.length} cuentas`}</span>
            </header>
            <ul className="divide-y divide-slate-800">
              {creds.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.label}</p>
                    <p className="truncate font-mono text-xs text-slate-400">{c.username}</p>
                    {revealed[c.id] !== undefined && (
                      <p className="mt-1 break-all rounded bg-slate-950 px-2 py-1 font-mono text-xs text-amber-300">
                        {revealed[c.id]}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button className="px-2 py-1 text-xs" onClick={() => toggleReveal(c)} title="Revelar (10 s)">
                      {revealed[c.id] !== undefined ? <EyeOff size={13} /> : <Eye size={13} />}
                    </Button>
                    <Button className="px-2 py-1 text-xs" onClick={() => copyUsername(c)} title="Copiar usuario">
                      {copiedId === c.id + ':user' ? <ClipboardCheck size={13} className="text-emerald-400" /> : <ClipboardCopy size={13} />}
                    </Button>
                    <Button className="px-2 py-1 text-xs" onClick={() => copyPassword(c)} title="Copiar contraseña">
                      <KeyRound size={13} className={copiedId === c.id ? 'text-emerald-400' : undefined} />
                    </Button>
                    <Button className="px-2 py-1 text-xs" onClick={() => openEdit(c)} title="Editar">
                      <Pencil size={13} />
                    </Button>
                    <Button className="px-2 py-1 text-xs text-red-400" onClick={() => onDelete(c)} title="Eliminar">
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={form.id ? 'Editar credencial' : 'Nueva credencial'}>
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
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-lpignore="true"
            />
          </Field>
          <Field label="Notas (opcional)">
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => { setFormOpen(false); setForm(emptyForm) }}>
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
