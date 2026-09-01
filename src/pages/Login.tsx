import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchBrandingSettings } from '../lib/queries'
import { Button, Field, Input } from '../components/ui'
import { clsx } from 'clsx'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
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
    setInfo('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate('/', { replace: true })
  }

  async function onSignUp(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
      },
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (data.session) {
      navigate('/', { replace: true })
      return
    }
    // Confirmación por correo activada en el proyecto: sin sesión hasta confirmar
    setMode('login')
    setInfo('Cuenta creada. Revisa tu correo y confirma tu cuenta para entrar.')
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 pt-safe pb-safe">
      <form onSubmit={mode === 'login' ? onSubmit : onSignUp} className="card w-full max-w-sm space-y-4 p-5 sm:p-6">
        <div className="mb-1 flex justify-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15 text-lg font-bold text-sky-300">S</span>
        </div>
        <h1 className="text-center text-xl font-semibold">{siteName}</h1>
        <p className="text-center text-sm text-slate-400">
          {mode === 'login' ? 'Acceso único a todos tus paneles' : 'Crea tu cuenta y empieza tu prueba'}
        </p>

        {mode === 'signup' && (
          <Field label="Nombre (opcional)">
            <Input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="name"
            />
          </Field>
        )}
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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </Button>

        {/* Cambio de modo (tabs discretas) */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setError('')
              setInfo('')
            }}
            className={clsx(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              mode === 'login' ? 'bg-sky-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
              setInfo('')
            }}
            className={clsx(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              mode === 'signup' ? 'bg-sky-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Crear cuenta
          </button>
        </div>

        <p className="text-center text-xs text-slate-500">
          {mode === 'login'
            ? '¿Sin cuenta? Regístrate gratis o pide acceso a un administrador del SuperPanel.'
            : 'Si existe un plan de prueba, se activará automáticamente al crear tu cuenta.'}
        </p>
      </form>
    </div>
  )
}
