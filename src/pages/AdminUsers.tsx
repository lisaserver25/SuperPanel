import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { adminCreateUser, adminDeleteUser, adminListUsers, adminSetPassword, adminUpdateUser } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { Badge, Button, EmptyState, Field, Input, Modal, Select } from '../components/ui'
import type { AdminUser } from '../lib/types'

type CreateState = { open: boolean; fullName: string; email: string; password: string; role: 'user' | 'superadmin' }
type PasswordState = { user: AdminUser; password: string } | null

export default function AdminUsers() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: adminListUsers })

  const [error, setError] = useState('')
  const [create, setCreate] = useState<CreateState>({ open: false, fullName: '', email: '', password: '', role: 'user' })
  const [pwModal, setPwModal] = useState<PasswordState>(null)
  const [busy, setBusy] = useState(false)

  const users = usersQuery.data ?? []

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await adminCreateUser({
        email: create.email.trim(),
        password: create.password,
        full_name: create.fullName.trim() || undefined,
        role: create.role,
      })
      setCreate({ open: false, fullName: '', email: '', password: '', role: 'user' })
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear')
    } finally {
      setBusy(false)
    }
  }

  async function onRoleChange(u: AdminUser, role: 'user' | 'superadmin') {
    setError('')
    const label = role === 'superadmin' ? 'superadmin' : 'cliente'
    if (!window.confirm(`¿Convertir «${u.email}» en ${label}?`)) return
    try {
      await adminUpdateUser({ id: u.id, role })
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el rol')
    }
  }

  async function onSetPassword(e: FormEvent) {
    e.preventDefault()
    if (!pwModal) return
    setBusy(true)
    setError('')
    try {
      await adminSetPassword(pwModal.user.id, pwModal.password)
      setPwModal(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(u: AdminUser) {
    setError('')
    if (!window.confirm(`¿Eliminar la cuenta «${u.email}»? Se borrarán sus paneles y credenciales guardadas.`)) return
    try {
      await adminDeleteUser(u.id)
      await invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Usuarios</h1>
          <p className="text-sm text-slate-400">Alta y gestión de accesos al SuperPanel (solo superadmin)</p>
        </div>
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => {
            setError('')
            setCreate({ open: true, fullName: '', email: '', password: '', role: 'user' })
          }}
        >
          <Plus size={16} /> Nuevo usuario
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {usersQuery.isLoading ? (
        <EmptyState>Cargando usuarios…</EmptyState>
      ) : users.length === 0 ? (
        <EmptyState>No hay usuarios todavía.</EmptyState>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Usuario</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Nombre</th>
                <th className="px-4 py-2.5">Rol</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Último acceso</th>
                <th className="px-4 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="max-w-[220px] px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
                        {(u.full_name || u.email).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate font-medium" title={u.email}>
                        {u.email}
                        {u.id === me?.id && <span className="ml-1 text-xs text-slate-500">(tú)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="hidden max-w-[160px] truncate px-4 py-2.5 text-slate-400 sm:table-cell">
                    {u.full_name || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.id === me?.id ? (
                      <Badge tone="sky">
                        <ShieldCheck size={11} /> Superadmin
                      </Badge>
                    ) : (
                      <Select
                        value={u.role}
                        onChange={(e) => onRoleChange(u, e.target.value as 'user' | 'superadmin')}
                        className="w-auto py-1 text-xs"
                        title="Cambiar rol"
                      >
                        <option value="user">Cliente</option>
                        <option value="superadmin">Superadmin</option>
                      </Select>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-slate-400 md:table-cell">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('es') : 'Nunca'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        className="px-2 py-1 text-xs"
                        title="Restablecer contraseña"
                        onClick={() => {
                          setError('')
                          setPwModal({ user: u, password: '' })
                        }}
                      >
                        <KeyRound size={13} />
                      </Button>
                      <Button
                        className="px-2 py-1 text-xs text-red-400"
                        title="Eliminar"
                        disabled={u.id === me?.id}
                        onClick={() => onDelete(u)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Crear usuario */}
      <Modal open={create.open} onClose={() => setCreate((c) => ({ ...c, open: false }))} title="Nuevo usuario">
        <form className="space-y-3" onSubmit={onCreate}>
          <Field label="Nombre (opcional)">
            <Input value={create.fullName} onChange={(e) => setCreate((c) => ({ ...c, fullName: e.target.value }))} />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={create.email}
              onChange={(e) => setCreate((c) => ({ ...c, email: e.target.value }))}
              placeholder="cliente@empresa.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Contraseña inicial">
            <Input
              type="text"
              required
              minLength={6}
              value={create.password}
              onChange={(e) => setCreate((c) => ({ ...c, password: e.target.value }))}
              className="font-mono"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Rol">
            <Select value={create.role} onChange={(e) => setCreate((c) => ({ ...c, role: e.target.value as 'user' | 'superadmin' }))}>
              <option value="user">Cliente</option>
              <option value="superadmin">Superadmin</option>
            </Select>
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <UserRound size={13} className="mt-0.5 shrink-0" />
            El usuario entrará directamente con estas credenciales (sin confirmación por correo). Nadie puede registrarse
            por su cuenta.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setCreate((c) => ({ ...c, open: false }))}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Creando…' : 'Crear usuario'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Restablecer contraseña */}
      <Modal open={!!pwModal} onClose={() => setPwModal(null)} title={`Contraseña de ${pwModal?.user.email ?? ''}`}>
        <form className="space-y-3" onSubmit={onSetPassword}>
          <Field label="Nueva contraseña">
            <Input
              type="text"
              required
              minLength={6}
              value={pwModal?.password ?? ''}
              onChange={(e) => setPwModal((p) => (p ? { ...p, password: e.target.value } : p))}
              className="font-mono"
              autoComplete="new-password"
            />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setPwModal(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
