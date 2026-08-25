import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ClipboardCheck, ClipboardCopy, ExternalLink, Eye, KeyRound, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { fetchCredentials, fetchPanel, panelLogin, revealCredential } from '../lib/queries'
import { Badge, Button, Select } from '../components/ui'

type LoginStatus = 'idle' | 'requesting' | 'sent' | 'done' | 'error'

interface BridgeMessage {
  source?: string
  type?: string
  message?: string
}

export default function PanelFrame() {
  const { id } = useParams<{ id: string }>()

  const panelQuery = useQuery({ queryKey: ['panel', id], queryFn: () => fetchPanel(id!), enabled: !!id })
  const credsQuery = useQuery({ queryKey: ['credentials'], queryFn: fetchCredentials })

  const panel = panelQuery.data ?? null
  const isOwn = panel?.kind === 'own'

  const panelOrigin = useMemo(() => {
    if (!panel) return null
    try {
      return new URL(panel.url).origin
    } catch {
      return null
    }
  }, [panel])

  // RLS: todas las credenciales que llegan ya son del usuario
  const credentials = useMemo(
    () => (credsQuery.data ?? []).filter((c) => c.panel_id === id),
    [credsQuery.data, id]
  )

  const [credentialId, setCredentialId] = useState('')
  const selected = credentials.find((c) => c.id === credentialId) ?? credentials[0] ?? null

  const [status, setStatus] = useState<LoginStatus>('idle')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState('')
  const [embedThird, setEmbedThird] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Los paneles propios siempre van embebidos; los de terceros, bajo demanda
  const showFrame = isOwn || embedThird

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
    if (!panelOrigin) return
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
  }, [panelOrigin, sendLogin])

  // Sondeo sp:ping hasta que el puente conteste (cubre carreras de carga)
  useEffect(() => {
    if (!isOwn || !panelOrigin || !showFrame) return
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
  }, [isOwn, panelOrigin, showFrame, reloadKey, credentialId])

  // Auto-login: pedir tokens a panel-login e inyectarlos vía handshake
  useEffect(() => {
    if (!isOwn || !selected) {
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
                'El panel no responde al handshake. Comprueba que está desplegada la última versión (puente) y que las cabeceras de iframe permiten el origen del hub.'
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
  }, [isOwn, selected?.id, reloadKey, sendLogin])

  async function copy(what: 'user' | 'password') {
    if (!selected) return
    try {
      const text = what === 'user' ? selected.username : await revealCredential(selected.id)
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(''), 1500)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'No se pudo copiar')
    }
  }

  function reloadFrame() {
    tokensRef.current = null
    setStatus('idle')
    setMessage('')
    setReloadKey((k) => k + 1)
  }

  if (panelQuery.isLoading) {
    return <div className="grid h-[calc(100vh-3.6rem)] place-items-center text-slate-500">Cargando panel…</div>
  }
  if (panelQuery.isError || !panel) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <p className="text-red-400">No se pudo cargar el panel.</p>
        <Link to="/" className="text-sm text-sky-400 hover:underline">
          ← Volver a la panelera
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
    <div className="flex h-[calc(100vh-3.6rem)] flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2">
        <Link to="/" className="mr-1 text-sm text-slate-400 hover:text-slate-200">
          ←
        </Link>
        <span className="font-medium">{panel.name}</span>
        <Badge tone={panel.kind === 'own' ? 'sky' : 'violet'}>{panel.kind === 'own' ? 'Propio' : 'Tercero'}</Badge>

        {selected && (
          <>
            {credentials.length > 1 && (
              <Select
                value={selected.id}
                onChange={(e) => {
                  setCredentialId(e.target.value)
                  reloadFrame()
                }}
                className="w-auto py-1 text-xs"
                title="Cuenta a usar"
              >
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
            <Button className="px-2 py-1 text-xs" onClick={() => copy('user')} title={selected.username}>
              <ClipboardCopy size={13} />
              {copied === 'user' ? <ClipboardCheck size={13} className="text-emerald-400" /> : null}
              Usuario
            </Button>
            <Button className="px-2 py-1 text-xs" onClick={() => copy('password')}>
              <KeyRound size={13} />
              {copied === 'password' ? <ClipboardCheck size={13} className="text-emerald-400" /> : null}
              Contraseña
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {showFrame ? (
            <Button className="px-2 py-1 text-xs" onClick={reloadFrame}>
              <RefreshCw size={13} /> Recargar
            </Button>
          ) : (
            <Button className="px-2 py-1 text-xs" onClick={() => setEmbedThird(true)}>
              <Eye size={13} /> Intentar embebido
            </Button>
          )}
          <Button className="px-2 py-1 text-xs" onClick={() => window.open(panel.url, '_blank', 'noopener')}>
            <ExternalLink size={13} /> Abrir en pestaña nueva
          </Button>
        </div>
      </div>

      {/* Estado */}
      {(isOwn || status === 'error') && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-xs">
          {isOwn && !selected && (
            <span className="text-slate-400">
              No tienes credenciales guardadas de este panel:{' '}
              <Link to="/vault" className="text-sky-400 hover:underline">
                añádelas en la Bóveda
              </Link>{' '}
              para el auto-login (también puedes iniciar sesión manualmente dentro del marco).
            </span>
          )}
          {isOwn && selected && status !== 'error' && status !== 'idle' && (
            <span
              className={clsx(
                status === 'done' ? 'text-emerald-400' : status === 'requesting' || status === 'sent' ? 'text-sky-300' : 'text-slate-400'
              )}
            >
              {statusText[status]}
            </span>
          )}
          {status === 'error' && <span className="text-red-400">Error: {message}</span>}
          {!isOwn && showFrame && (
            <span className="flex items-center gap-1 text-slate-400">
              <AlertTriangle size={12} /> Si el panel de terceros bloquea el embebido, usa «Abrir en pestaña nueva» con las
              credenciales copiadas.
            </span>
          )}
        </div>
      )}

      {/* Marco */}
      {showFrame ? (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={panel.url}
          title={panel.name}
          className="flex-1 border-0 bg-white"
          allow="clipboard-write"
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">
          <div className="max-w-md space-y-3">
            <p>
              Panel de terceros: copia usuario y contraseña desde la barra superior y ábrelo en una pestaña nueva. El
              embebido es opcional porque muchos paneles de terceros lo bloquean.
            </p>
            <Button variant="primary" onClick={() => window.open(panel.url, '_blank', 'noopener')}>
              <ExternalLink size={14} /> Abrir en pestaña nueva
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
