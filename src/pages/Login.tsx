import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchBrandingSettings } from '../lib/queries'
import { Button, Field, Input } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const settingsQuery = useQuery({ queryKey: ['super-settings'], queryFn: fetchBrandingSettings })
  const siteName = settingsQuery.data?.site_name ?? 'SuperPanel'

  useEffect(() => {
    document.title = siteName
  }, [siteName])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <h1 className="text-center text-xl font-semibold">{siteName}</h1>
        <p className="text-center text-sm text-slate-400">Acceso único a todos tus paneles</p>
        <Field label="Email">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="username"
          />
        </Field>
        <Field label="Contraseña">
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
        <p className="text-center text-xs text-slate-500">
          ¿Sin cuenta? El acceso solo lo proporciona un administrador del SuperPanel.
        </p>
      </form>
    </div>
  )
}
