import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  Folder,
  Globe,
  KeyRound,
  Layout,
  Lock,
  RefreshCw,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { fetchCredentials, fetchPanel, panelLogin, revealCredential } from '../lib/queries'
import { getPanelEmbedPreference, savePanelEmbedPreference } from '../lib/categories'
import { useAuth } from '../lib/auth'
import { Badge, Button, Select } from '../components/ui'

type LoginStatus = 'idle' | 'requesting' | 'sent' | 'done' | 'error'

interface BridgeMessage {
  source?: string
  type?: string
  message?: string
}

export default function PanelFrame() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()

  const panelQuery = useQuery({ queryKey: ['panel', id], queryFn: () => fetchPanel(id!), enabled: !!id })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })

  const panel = panelQuery.data ?? null
  const isOwn = panel?.kind === 'own'

  // Recordar si el panel se visualiza embebido o como acceso directo
  const [viewMode, setViewMode] = useState<'launcher' | 'frame'>('frame')

  useEffect(() => {
    if (panel?.id) {
      const pref = getPanelEmbedPreference(user?.id, panel.id, panel.kind)
      setViewMode(pref)
    }
  }, [panel?.id, panel?.kind, user?.id])

  function handleSwitchViewMode(mode: 'launcher' | 'frame') {
    setViewMode(mode)
    if (panel?.id) {
      savePanelEmbedPreference(user?.id, panel.id, mode)
    }
  }

  const panelOrigin = useMemo(() => {
    if (!panel) return null
    try {
      return new URL(panel.url).origin
    } catch {
      return null
    }
  }, [panel])

  // Credenciales accesibles para este panel
  const credentials = useMemo(
    () => (credsQuery.data ?? []).filter((c) => c.panel_id === id),
    [credsQuery.data, id]
  )

  const [credentialId, setCredentialId] = useState('')
  const selected = credentials.find((c) => c.id === credentialId) ?? credentials[0] ?? null

  const [status, setStatus] = useState<LoginStatus>('idle')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState<'user' | 'password' | ''>('')
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const tokensRef = useRef<{ access_token: string; refresh_token: string } | null>(null)
  const bridgeReadyRef = useRef(false)

  const sendLogin = useCallback(() => {
    const tokens = tokensRef.current
    const win = iframeRef.current?.contentWindow
    if (!tokens || !win || !panelOrigin) return
    win.postMessage(
      { source: 'superpaneles-hub', type: 'sp:login', access_token: tokens.access_token, refresh_token: tokens.refresh_token },
      panelOrigin
    )
    setStatus('sent')
  }, [panelOrigin])

  // Handshake con el puente del panel (postMessage con allowlist de origen)
  useEffect(() => {
    if (!panelOrigin || viewMode !== 'frame') return
    function onMessage(event: MessageEvent) {
      if (event.origin !== panelOrigin) return
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as BridgeMessage | null
      if (!data || data.source !== 'superpaneles-bridge') return
      if (data.type === 'sp:ready') {
        bridgeReadyRef.current = true
        if (tokensRef.current) sendLogin()
      } else if (data.type === 'sp:done') {
        setStatus('done')
      } else if (data.type === 'sp:error') {
        setStatus('error')
        setMessage(data.message ?? 'El panel no pudo aplicar la sesión')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [panelOrigin, sendLogin, viewMode])

  // Sondeo sp:ping hasta que el puente conteste (cubre carreras de carga)
  useEffect(() => {
    if (!isOwn || !panelOrigin || viewMode !== 'frame') return
    bridgeReadyRef.current = false
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      const win = iframeRef.current?.contentWindow
      if (bridgeReadyRef.current || attempts > 25 || !win) {
        window.clearInterval(timer)
        return
      }
      win.postMessage({ source: 'superpaneles-hub', type: 'sp:ping' }, panelOrigin)
    }, 600)
    return () => window.clearInterval(timer)
  }, [isOwn, panelOrigin, reloadKey, credentialId, viewMode])

  // Auto-login: pedir tokens a panel-login e inyectarlos vía handshake (solo si está en frame)
  useEffect(() => {
    if (!isOwn || !selected || viewMode !== 'frame') {
      tokensRef.current = null
      setStatus('idle')
      setMessage('')
      return
    }
    let cancelled = false
    let watchdog = 0
    setStatus('requesting')
    setMessage('')
    panelLogin(selected.id)
      .then((tokens) => {
        if (cancelled) return
        tokensRef.current = { access_token: tokens.access_token, refresh_token: tokens.refresh_token }
        if (bridgeReadyRef.current) {
          sendLogin()
        } else {
          watchdog = window.setTimeout(() => {
            if (!cancelled && !bridgeReadyRef.current) {
              setStatus('error')
              setMessage(
                'El panel no responde al handshake. Comprueba que el panel tenga el puente activo o usa la vista de acceso directo.'
              )
            }
          }, 15_000)
        }
      })
      .catch((err: Error) => {
        if (cancelled) return
        setStatus('error')
        setMessage(err.message)
      })
    return () => {
      cancelled = true
      if (watchdog) window.clearTimeout(watchdog)
    }
  }, [isOwn, selected?.id, reloadKey, sendLogin, viewMode])

  async function copy(what: 'user' | 'password') {
    if (!selected) return
    try {
      const text = what === 'user' ? selected.username : await revealCredential(selected.id)
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(''), 2000)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo copiar')
    }
  }

  async function toggleRevealPassword() {
    if (revealedPassword) {
      setRevealedPassword(null)
      return
    }
    if (!selected) return
    setRevealing(true)
    try {
      const pw = await revealCredential(selected.id)
      setRevealedPassword(pw)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo descifrar la contraseña')
    } finally {
      setRevealing(false)
    }
  }

  function reloadFrame() {
    tokensRef.current = null
    setStatus('idle')
    setMessage('')
    setReloadKey((k) => k + 1)
  }

  function openInNewTab() {
    if (!panel) return
    window.open(panel.url, '_blank', 'noopener,noreferrer')
  }

  if (panelQuery.isLoading) {
    return <div className="grid h-full flex-1 place-items-center text-slate-500 text-xs">Cargando panel…</div>
  }
  if (panelQuery.isError || !panel) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <p className="text-red-400 text-xs">No se pudo cargar el panel.</p>
        <Link to="/" className="text-xs text-sky-400 hover:underline">
          ← Volver a las categorías
        </Link>
      </div>
    )
  }

  const statusText: Record<LoginStatus, string> = {
    idle: '',
    requesting: 'Solicitando sesión al panel…',
    sent: 'Iniciando sesión en el panel…',
    done: 'Sesión activa dentro del marco',
    error: '',
  }

  return (
    <div className="flex h-full flex-1 min-h-0 flex-col bg-slate-950">
      {/* Toolbar compacta: datos del panel, categorías, conmutador de vista y acciones */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 bg-slate-900/90 px-3 py-1 shrink-0 text-xs">
        <Link to="/" className="text-sm text-slate-400 hover:text-slate-200 mr-0.5" title="Volver a las categorías">
          ←
        </Link>

        {panel.logo_url ? (
          <img src={panel.logo_url} alt="" className="h-4 w-4 rounded object-cover" />
        ) : null}

        <h1 className="max-w-[22ch] truncate text-xs sm:text-sm font-semibold leading-none text-slate-100" title={panel.name}>
          {panel.name}
        </h1>

        <Badge tone="slate">
          <Folder size={10} /> {panel.category || 'General'}
        </Badge>

        <Badge tone={panel.kind === 'own' ? 'sky' : 'violet'}>
          {panel.kind === 'own' ? 'Propio' : 'Tercero'}
        </Badge>

        {panel.is_shared && (
          <Badge tone="violet">
            <Users size={10} /> Compartido
          </Badge>
        )}

        {/* Indicador de modo de vista y conmutador recordable */}
        {viewMode === 'frame' ? (
          <div className="flex items-center gap-1 ml-0.5">
            <Badge tone="sky">
              <Layout size={10} /> Marco embebido
            </Badge>
            <Button
              className="text-[11px] px-1.5 py-0.5 text-slate-400 hover:text-amber-300 border border-slate-800 hover:border-amber-800/60"
              onClick={() => handleSwitchViewMode('launcher')}
              title="Si la página no carga en el marco, cambiar y recordar como acceso directo"
            >
              <Globe size={11} className="text-amber-400" /> Cambiar a Acceso directo
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 ml-0.5">
            <Badge tone="violet">
              <Globe size={10} /> Acceso directo
            </Badge>
            <Button
              className="text-[11px] px-1.5 py-0.5 text-slate-400 hover:text-sky-300 border border-slate-800 hover:border-sky-800/60"
              onClick={() => handleSwitchViewMode('frame')}
              title="Intentar cargar embebido en el marco"
            >
              <Layout size={11} className="text-sky-400" /> Probar en marco embebido
            </Button>
          </div>
        )}

        {/* Botones de acción derecha */}
        <div className="ml-auto flex items-center gap-1.5">
          {viewMode === 'frame' && (
            <Button className="px-2 py-0.5 text-[11px]" onClick={reloadFrame}>
              <RefreshCw size={11} /> Recargar
            </Button>
          )}
          <Button
            variant="primary"
            className="px-2.5 py-0.5 text-xs font-semibold shadow-xs"
            onClick={openInNewTab}
            title="Abrir página web en una pestaña nueva del navegador"
          >
            <ArrowUpRight size={13} /> Abrir {panel.name}
          </Button>
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL SEGÚN VIEWMODE */}
      {viewMode === 'launcher' ? (
        /* VISTA DE ACCESO DIRECTO (SIN PANTALLA EN BLANCO, CON CREDENCIALES A MANO) */
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Tarjeta principal del panel */}
            <div className="card space-y-5 p-6 border-slate-800 bg-slate-900/90 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  {panel.logo_url ? (
                    <img src={panel.logo_url} alt="" className="h-14 w-14 rounded-xl bg-slate-800 object-cover shadow" />
                  ) : (
                    <span className="grid h-14 w-14 place-items-center rounded-xl bg-sky-950 text-sky-300 font-bold text-xl border border-sky-800/60">
                      {panel.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <h2 className="text-xl font-bold text-slate-100">{panel.name}</h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{panel.url}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge tone="slate">
                        <Folder size={11} /> {panel.category || 'General'}
                      </Badge>
                      <Badge tone="violet">
                        <Globe size={11} /> Acceso directo
                      </Badge>
                    </div>
                  </div>
                </div>

                <Button
                  variant="primary"
                  onClick={openInNewTab}
                  className="px-4 py-2.5 text-sm font-semibold shadow-lg shadow-sky-950/50 flex items-center gap-2"
                >
                  <ArrowUpRight size={16} /> Abrir web
                </Button>
              </div>

              {panel.notes && (
                <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-300">
                  <p className="font-semibold text-slate-400 mb-0.5">Notas del panel:</p>
                  <p className="whitespace-pre-wrap">{panel.notes}</p>
                </div>
              )}
            </div>

            {/* Tarjeta de Autenticación y Credenciales Cifradas */}
            <div className="card space-y-4 p-6 border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="text-emerald-400" size={18} />
                  <h3 className="text-base font-semibold text-slate-100">Datos de acceso del panel</h3>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 rounded-full px-2.5 py-0.5">
                  <ShieldCheck size={13} /> Cifrado seguro
                </div>
              </div>

              {selected ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Copia tus credenciales con un clic para pegarlas directamente en la pantalla de inicio de sesión de{' '}
                    <strong>{panel.name}</strong>:
                  </p>

                  {credentials.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Cuenta:</span>
                      <Select
                        value={selected.id}
                        onChange={(e) => setCredentialId(e.target.value)}
                        className="py-1 text-xs"
                      >
                        {credentials.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} ({c.username})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  {/* Campo de Usuario */}
                  <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <User size={16} className="text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase font-semibold text-slate-500">Usuario / Email</span>
                        <span className="font-mono text-sm text-slate-200 truncate block">{selected.username}</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => copy('user')}
                      className={clsx(
                        'px-3 py-1.5 text-xs font-medium shrink-0 transition-colors',
                        copied === 'user' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500' : 'bg-slate-800 hover:bg-slate-700'
                      )}
                    >
                      {copied === 'user' ? <Check size={14} className="text-emerald-400" /> : <ClipboardCopy size={14} />}
                      <span>{copied === 'user' ? 'Copiado' : 'Copiar usuario'}</span>
                    </Button>
                  </div>

                  {/* Campo de Contraseña */}
                  <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <Lock size={16} className="text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase font-semibold text-slate-500">Contraseña</span>
                        <span className="font-mono text-sm text-slate-200 truncate block">
                          {revealedPassword ?? '••••••••••••'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        onClick={toggleRevealPassword}
                        disabled={revealing}
                        className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title={revealedPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      >
                        {revealedPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </Button>
                      <Button
                        onClick={() => copy('password')}
                        className={clsx(
                          'px-3 py-1.5 text-xs font-medium transition-colors',
                          copied === 'password'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500'
                            : 'bg-slate-800 hover:bg-slate-700'
                        )}
                      >
                        {copied === 'password' ? <Check size={14} className="text-emerald-400" /> : <KeyRound size={14} />}
                        <span>{copied === 'password' ? 'Copiada' : 'Copiar contraseña'}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-4 text-center space-y-2">
                  <p className="text-xs text-slate-400">
                    No has guardado credenciales para este panel todavía.
                  </p>
                  <p className="text-xs text-slate-500">
                    Puedes editar el panel desde la pantalla principal para guardar el usuario y contraseña cifrados.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VISTA DE MARCO EMBEBIDO (IFRAME LIMPIO SIN AVISOS MOLESTOS) */
        <div className="flex flex-1 flex-col">
          {/* Estado del auto-login (solo paneles propios) */}
          {isOwn && (status !== 'idle' || message) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/60 bg-slate-950/60 px-4 py-1 text-xs">
              {selected && status !== 'error' && status !== 'idle' && (
                <span
                  className={clsx(
                    status === 'done'
                      ? 'text-emerald-400 font-medium'
                      : status === 'requesting' || status === 'sent'
                      ? 'text-sky-300'
                      : 'text-slate-400'
                  )}
                >
                  {statusText[status]}
                </span>
              )}
              {status === 'error' && <span className="text-red-400">Error: {message}</span>}
            </div>
          )}

          {/* Iframe a pantalla completa */}
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={panel.url}
            title={panel.name}
            className="min-h-0 flex-1 border-0 bg-white"
            allow="clipboard-write; camera; microphone; geolocation"
          />
        </div>
      )}
    </div>
  )
}
