import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Field, Input } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      setBusy(false)
      if (err) {
        setError(err.message)
        return
      }
      navigate('/', { replace: true })
    } else {
      const { data, error: err } = await supabase.auth.signUp({ email, password })
      setBusy(false)
      if (err) {
        setError(err.message)
        return
      }
      if (data.session) {
        navigate('/', { replace: true })
      } else {
        setNotice('Cuenta creada. Revisa tu correo para confirmarla y vuelve a entrar.')
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <h1 className="text-center text-xl font-semibold">SuperPanel</h1>
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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-emerald-400">{notice}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </Button>
        <button
          type="button"
          className="w-full text-center text-xs text-sky-400 hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError('')
            setNotice('')
          }}
        >
          {mode === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta: entrar'}
        </button>
      </form>
    </div>
  )
}
