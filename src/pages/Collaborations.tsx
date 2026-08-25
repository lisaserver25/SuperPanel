import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Mail,
  Plus,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  deleteCollaboration,
  fetchCollaborations,
  fetchPendingPanelShares,
  respondCollaboration,
  respondPanelShare,
  sendCollaborationInvite,
  updatePanelShareCategory,
} from '../lib/queries'
import { Badge, Button, EmptyState, Field, Input, Modal } from '../components/ui'
import type { PanelShare } from '../lib/types'

export default function Collaborations() {
  const qc = useQueryClient()
  const [inviteEmail, setInviteEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal para aceptar panel con categoría personal
  const [acceptingShare, setAcceptingShare] = useState<PanelShare | null>(null)
  const [personalCategory, setPersonalCategory] = useState('General')

  // Modal para editar categoría personal de un panel compartido ya aceptado
  const [editingCategoryShare, setEditingCategoryShare] = useState<{ id: string; category: string } | null>(null)

  const collabsQuery = useQuery({
    queryKey: ['collaborations'],
    queryFn: fetchCollaborations,
  })

  const pendingSharesQuery = useQuery({
    queryKey: ['pending-panel-shares'],
    queryFn: fetchPendingPanelShares,
  })

  const collabs = collabsQuery.data ?? { sent: [], received: [] }
  const pendingPanelShares = pendingSharesQuery.data ?? []

  async function invalidateAll() {
    await qc.invalidateQueries({ queryKey: ['collaborations'] })
    await qc.invalidateQueries({ queryKey: ['pending-panel-shares'] })
    await qc.invalidateQueries({ queryKey: ['accepted-collaborators'] })
    await qc.invalidateQueries({ queryKey: ['panels'] })
  }

  async function onSendInvite(e: FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await sendCollaborationInvite(inviteEmail.trim())
      setInviteEmail('')
      setSuccess(`Invitación enviada correctamente a ${inviteEmail.trim()}`)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la invitación')
    } finally {
      setBusy(false)
    }
  }

  async function onRespondCollab(id: string, accept: boolean) {
    setError('')
    setSuccess('')
    try {
      await respondCollaboration(id, accept)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al responder a la invitación')
    }
  }

  async function onDeleteCollab(id: string) {
    if (!window.confirm('¿Eliminar esta conexión de colaboración?')) return
    setError('')
    try {
      await deleteCollaboration(id)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  function openAcceptShareModal(share: PanelShare) {
    setAcceptingShare(share)
    setPersonalCategory(share.panel?.category || 'General')
  }

  async function onConfirmAcceptShare(e: FormEvent) {
    e.preventDefault()
    if (!acceptingShare) return
    setBusy(true)
    setError('')
    try {
      await respondPanelShare(acceptingShare.id, true, personalCategory.trim() || 'General')
      setAcceptingShare(null)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar el panel')
    } finally {
      setBusy(false)
    }
  }

  async function onRejectShare(shareId: string) {
    if (!window.confirm('¿Rechazar esta invitación de panel?')) return
    setError('')
    try {
      await respondPanelShare(shareId, false)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar')
    }
  }

  async function onSaveEditedCategory(e: FormEvent) {
    e.preventDefault()
    if (!editingCategoryShare) return
    setBusy(true)
    setError('')
    try {
      await updatePanelShareCategory(editingCategoryShare.id, editingCategoryShare.category.trim() || 'General')
      setEditingCategoryShare(null)
      await invalidateAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la categoría')
    } finally {
      setBusy(false)
    }
  }

  const pendingReceivedCollabs = collabs.received.filter((c) => c.status === 'pending')
  const acceptedCollabs = [
    ...collabs.sent.filter((c) => c.status === 'accepted'),
    ...collabs.received.filter((c) => c.status === 'accepted'),
  ]
  const pendingSentCollabs = collabs.sent.filter((c) => c.status === 'pending')

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Colaboración & Compartición</h1>
          <p className="text-sm text-slate-400">
            Conecta con otros usuarios y comparte el acceso a paneles manteniendo tus credenciales privadas.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      {/* 1. Paneles compartidos pendientes de aceptar */}
      {pendingPanelShares.length > 0 && (
        <section className="card border-sky-500/40 bg-sky-950/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="text-sky-400" size={18} />
            <h2 className="text-base font-semibold text-sky-200">
              Invitaciones de paneles pendientes de aceptar ({pendingPanelShares.length})
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Otros usuarios han compartido estos paneles contigo. Acéptalos y elige tu categoría personal para
            incorporarlos a tu panelera.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pendingPanelShares.map((s) => (
              <div key={s.id} className="card bg-slate-900/90 p-3 space-y-2 border border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-100">{s.panel?.name || 'Panel compartido'}</p>
                    <p className="truncate text-xs text-slate-400">
                      Compartido por: <span className="text-sky-300">{s.shared_by_name || s.shared_by}</span>
                    </p>
                  </div>
                  <Badge tone={s.panel?.kind === 'own' ? 'sky' : 'violet'}>
                    {s.panel?.kind === 'own' ? 'Propio' : 'Tercero'}
                  </Badge>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
                  <Button
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                    onClick={() => onRejectShare(s.id)}
                  >
                    <X size={13} /> Rechazar
                  </Button>
                  <Button
                    variant="primary"
                    className="px-2.5 py-1 text-xs"
                    onClick={() => openAcceptShareModal(s)}
                  >
                    <Check size={13} /> Aceptar y clasificar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. Invitaciones de conexión recibidas */}
      {pendingReceivedCollabs.length > 0 && (
        <section className="card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="text-amber-400" size={18} />
            <h2 className="text-base font-semibold text-slate-200">
              Solicitudes de conexión recibidas ({pendingReceivedCollabs.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/40">
            {pendingReceivedCollabs.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {c.sender_name ? `${c.sender_name} (${c.sender_email})` : c.sender_email}
                  </p>
                  <p className="text-xs text-slate-500">
                    Quiere conectar contigo para compartir paneles fácilmente.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    className="px-2.5 py-1 text-xs text-red-400"
                    onClick={() => onRespondCollab(c.id, false)}
                  >
                    <X size={13} /> Rechazar
                  </Button>
                  <Button
                    variant="primary"
                    className="px-2.5 py-1 text-xs"
                    onClick={() => onRespondCollab(c.id, true)}
                  >
                    <Check size={13} /> Aceptar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Enviar nueva invitación de colaboración */}
      <section className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="text-sky-400" size={18} />
          <h2 className="text-base font-semibold text-slate-200">Conectar con un nuevo usuario</h2>
        </div>
        <p className="text-xs text-slate-400">
          Envía una invitación por correo a otro usuario para conectar vuestras cuentas y compartir paneles.
        </p>
        <form onSubmit={onSendInvite} className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="usuario@empresa.com"
            className="min-w-[260px] flex-1 text-sm"
          />
          <Button variant="primary" type="submit" disabled={busy}>
            <Plus size={15} /> {busy ? 'Enviando…' : 'Enviar invitación'}
          </Button>
        </form>
      </section>

      {/* 4. Colaboradores conectados */}
      <section className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="text-emerald-400" size={18} />
          <h2 className="text-base font-semibold text-slate-200">
            Colaboradores conectados ({acceptedCollabs.length})
          </h2>
        </div>
        {acceptedCollabs.length === 0 ? (
          <EmptyState>Todavía no tienes colaboradores conectados. Envía una invitación arriba.</EmptyState>
        ) : (
          <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/40">
            {acceptedCollabs.map((c) => {
              const otherEmail = c.sender_email || c.receiver_email
              const otherName = c.sender_name || c.receiver_name
              return (
                <div key={c.id} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-emerald-300">
                      <UserCheck size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{otherEmail}</p>
                      {otherName && <p className="text-xs text-slate-400">{otherName}</p>}
                    </div>
                  </div>
                  <Button
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                    title="Eliminar conexión"
                    onClick={() => onDeleteCollab(c.id)}
                  >
                    <Trash2 size={13} /> Desconectar
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 5. Invitaciones enviadas pendientes */}
      {pendingSentCollabs.length > 0 && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-400">
            Invitaciones enviadas pendientes ({pendingSentCollabs.length})
          </h2>
          <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/30 text-xs">
            {pendingSentCollabs.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-300">{c.receiver_email}</span>
                  <Badge tone="slate">Esperando respuesta</Badge>
                </div>
                <Button
                  className="px-2 py-0.5 text-xs text-red-400"
                  onClick={() => onDeleteCollab(c.id)}
                >
                  Cancelar
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modal para Aceptar Panel con Categoría Personal */}
      <Modal
        open={!!acceptingShare}
        onClose={() => setAcceptingShare(null)}
        title="Aceptar panel compartido"
      >
        <form onSubmit={onConfirmAcceptShare} className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-1">
            <p className="text-sm font-medium text-slate-200">{acceptingShare?.panel?.name}</p>
            <p className="text-xs text-slate-400">
              Compartido por:{' '}
              <span className="text-sky-300">{acceptingShare?.shared_by_name || acceptingShare?.shared_by}</span>
            </p>
          </div>

          <Field label="Elige en qué categoría / sistema quieres organizarlo:">
            <Input
              required
              value={personalCategory}
              onChange={(e) => setPersonalCategory(e.target.value)}
              placeholder="Ej: Facturación, Sistemas, Compartidos..."
            />
          </Field>

          <p className="text-xs text-slate-400">
            Esta categoría es tuya personal. El panel se mostrará en tu catálogo y en el menú desplegable del Header
            bajo esta categoría.
          </p>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setAcceptingShare(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Aceptando…' : 'Aceptar e incorporar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal para Editar Categoría Personal de un panel compartido */}
      <Modal
        open={!!editingCategoryShare}
        onClose={() => setEditingCategoryShare(null)}
        title="Cambiar categoría personal del panel"
      >
        <form onSubmit={onSaveEditedCategory} className="space-y-4">
          <Field label="Categoría / Sistema personal">
            <Input
              required
              value={editingCategoryShare?.category || ''}
              onChange={(e) =>
                setEditingCategoryShare((prev) => (prev ? { ...prev, category: e.target.value } : null))
              }
              placeholder="Ej: Facturación, Sistemas, Clientes..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <Button type="button" onClick={() => setEditingCategoryShare(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar categoría'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
