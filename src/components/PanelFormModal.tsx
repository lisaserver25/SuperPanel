import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal, Select } from './ui'
import { savePanel } from '../lib/queries'
import type { Panel, PanelKind } from '../lib/types'

interface FormState {
  id?: string
  name: string
  url: string
  kind: PanelKind
  logo_url: string
  sort_order: string
  notes: string
  supabase_url: string
  supabase_anon_key: string
}

const emptyForm: FormState = {
  name: '',
  url: 'https://',
  kind: 'own',
  logo_url: '',
  sort_order: '0',
  notes: '',
  supabase_url: 'https://',
  supabase_anon_key: '',
}

function fromPanel(p: Panel): FormState {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    kind: p.kind,
    logo_url: p.logo_url ?? '',
    sort_order: String(p.sort_order),
    notes: p.notes ?? '',
    supabase_url: p.supabase_url ?? 'https://',
    supabase_anon_key: p.supabase_anon_key ?? '',
  }
}

// Alta/edición de un panel DEL PROPIO USUARIO (catálogo personal)
export default function PanelFormModal({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  initial: Panel | null
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(initial ? fromPanel(initial) : { ...emptyForm })
      setError('')
    }
  }, [open, initial])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      new URL(form.url)
    } catch {
      setError('La URL del panel no es válida')
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
      await savePanel({
        id: form.id,
        name: form.name.trim(),
        url: form.url.trim(),
        kind: form.kind,
        logo_url: form.logo_url.trim() || null,
        notes: form.notes.trim() || null,
        sort_order: Number.parseInt(form.sort_order || '0', 10) || 0,
        supabase_url: form.kind === 'own' ? form.supabase_url.trim() : null,
        supabase_anon_key: form.kind === 'own' ? form.supabase_anon_key.trim() : null,
      })
      onClose()
      await qc.invalidateQueries({ queryKey: ['panels'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Editar panel' : 'Añadir panel'}>
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ej: gestlisa" />
          </Field>
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PanelKind }))}>
              <option value="own">Propio (auto-login con puente)</option>
              <option value="third">Tercero (copiar credenciales y abrir)</option>
            </Select>
          </Field>
        </div>
        <Field label="URL del panel">
          <Input required value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://tu-panel.com" />
        </Field>
        {form.kind === 'own' && (
          <>
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
          </>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
          <Field label="Logo URL (opcional)">
            <Input value={form.logo_url} onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))} />
          </Field>
          <Field label="Orden">
            <Input type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notas (opcional)">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
