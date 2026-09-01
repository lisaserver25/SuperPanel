// ============================================================================
// panel-proxy: proxy inverso de sesión para paneles X-UI / 3x-ui (y similares).
//
// ¿Por qué existe? x-ui emite cookies de sesión SameSite=Lax, que el navegador
// NO envía en iframes cross-origin: por eso el login manual dentro del marco
// nunca "pegaba". Este proxy sirve el panel bajo el dominio del hub con una
// cookie propia firmada (HMAC) y reescribe las cookies del panel a
// SameSite=None; Secure con nombres prefijados, de modo que la sesión vive en
// el marco embebido.
//
// Rutas (verify_jwt = false; la autenticación es por JWT en /__session y por
// cookie firmada en el resto):
//   POST /functions/v1/panel-proxy/{panelId}/__session   → crea la cookie de proxy
//   *    /functions/v1/panel-proxy/{panelId}/{...ruta}   → proxy al panel
//
// Seguridad:
//   - /__session exige JWT de Supabase y acceso al panel (propietario o
//     compartición aceptada) y que el panel tenga login_type = 'xui'.
//   - El resto de rutas exige la cookie firmada válida para ESE panel.
//   - Al panel solo se le reenvían cookies prefijadas spp_<pid8>_*; jamás se
//     filtran cookies del hub (incluido el JWT de Supabase).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SESSION_TTL_S = 6 * 60 * 60

const PASS_REQ_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent']
const PASS_RES_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'expires', 'pragma']
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
])

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  })
}

async function hmacHex(data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(SERVICE_ROLE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function cookieNameFor(panelId: string): string {
  return `sp_px_${panelId.replace(/-/g, '').slice(0, 8)}`
}

async function createSessionToken(userId: string, panelId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S
  const payload = `${userId}.${panelId}.${exp}`
  const sig = await hmacHex(payload)
  return `v1.${payload}.${sig}`
}

async function verifySessionToken(token: string | undefined, panelId: string): Promise<{ userId: string } | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'v1') return null
  const [, userId, pid, expStr, sig] = parts
  if (pid !== panelId) return null
  const exp = Number.parseInt(expStr, 10)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null
  const expected = await hmacHex(`${userId}.${pid}.${expStr}`)
  if (sig !== expected) return null
  return { userId }
}

interface PanelRow {
  id: string
  url: string
  owner_id: string
  login_type: string | null
}

async function loadPanel(panelId: string): Promise<PanelRow | null> {
  const admin = adminClient()
  const { data } = await admin
    .from('super_panels')
    .select('id, url, owner_id, login_type')
    .eq('id', panelId)
    .maybeSingle()
  return (data as PanelRow | null) ?? null
}

async function userCanAccessPanel(userId: string, email: string, panel: PanelRow): Promise<boolean> {
  if (panel.owner_id === userId) return true
  const admin = adminClient()
  const { data } = await admin
    .from('super_panel_shares')
    .select('id')
    .eq('panel_id', panel.id)
    .eq('status', 'accepted')
    .or(`shared_with_id.eq.${userId},shared_with_email.ilike.${email}`)
    .maybeSingle()
  return !!data
}

function rewriteLocation(loc: string, panelOrigin: string, proxyPrefix: string, panelId: string): string {
  if (loc.startsWith('/')) return `${proxyPrefix}/${panelId}${loc}`
  if (panelOrigin && loc.toLowerCase().startsWith(panelOrigin.toLowerCase())) {
    return `${proxyPrefix}/${panelId}${loc.slice(panelOrigin.length)}`
  }
  return loc
}

function rewriteSetCookie(sc: string, panelId: string): string {
  const semi = sc.indexOf(';')
  const pair = semi === -1 ? sc : sc.slice(0, semi)
  const attrs = semi === -1 ? [] : sc.slice(semi + 1).split(';')
  const eq = pair.indexOf('=')
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim()
  const value = eq === -1 ? '' : pair.slice(eq + 1).trim()

  const keep: string[] = []
  for (const raw of attrs) {
    const a = raw.trim()
    if (!a) continue
    const lower = a.toLowerCase()
    if (lower.startsWith('domain=') || lower.startsWith('path=') || lower.startsWith('samesite=') || lower === 'secure') {
      continue
    }
    keep.push(a)
  }
  keep.push('Path=/')
  keep.push('SameSite=None')
  keep.push('Secure')
  return `spp_${panelId.replace(/-/g, '').slice(0, 8)}_${name}=${value}; ${keep.join('; ')}`
}

function rewriteHtml(html: string, proxyPrefix: string, panelId: string): string {
  const p = `${proxyPrefix}/${panelId}`
  // URLs raíz-relativas en atributos comunes (deja intactas las // y http*)
  return html.replace(
    /(\s(?:href|src|action|poster|data-src|data-url)\s*=\s*)(['"])\/(?!\/)/gi,
    (_m, pre: string, q: string) => `${pre}${q}${p}/`
  )
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const marker = '/panel-proxy/'
  const idx = url.pathname.indexOf(marker)
  if (idx === -1) return json(req, { error: 'not_found' }, 404)

  const proxyPrefix = url.pathname.slice(0, idx + marker.length - 1) // .../panel-proxy
  const rest = url.pathname.slice(idx + marker.length)
  const [panelIdRaw, ...pathParts] = rest.split('/')
  const panelId = panelIdRaw ?? ''
  const subPath = pathParts.join('/')

  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(panelId)
  if (!isUuid) return json(req, { error: 'panel_invalido' }, 400)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) })

  const panel = await loadPanel(panelId)
  if (!panel) return json(req, { error: 'panel_no_encontrado' }, 404)
  if (panel.login_type !== 'xui') {
    return json(req, { error: 'proxy_no_habilitado', detail: 'Este panel no tiene el login embebido (X-UI) activado' }, 403)
  }

  const cName = cookieNameFor(panelId)

  // ---------------------------------------------------------------- /__session
  if (subPath === '__session') {
    if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json(req, { error: 'unauthorized' }, 401)

    const admin = adminClient()
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userError || !user) return json(req, { error: 'unauthorized' }, 401)

    const ok = await userCanAccessPanel(user.id, (user.email ?? '').toLowerCase(), panel)
    if (!ok) return json(req, { error: 'forbidden' }, 403)

    const value = await createSessionToken(user.id, panelId)
    const cookie = `${cName}=${value}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=None`
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsFor(req), 'Content-Type': 'application/json', 'Set-Cookie': cookie },
    })
  }

  // ------------------------------------------------------------------- proxy
  const cookies = parseCookies(req.headers.get('Cookie'))
  const session = await verifySessionToken(cookies[cName], panelId)
  if (!session) return json(req, { error: 'unauthorized', detail: 'Sesión del proxy no válida; abre el panel de nuevo' }, 401)

  // URL destino: la ruta es relativa a la URL del panel (soporta base paths)
  const base = panel.url.endsWith('/') ? panel.url : `${panel.url}/`
  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(subPath, base)
    upstreamUrl.search = url.search
  } catch {
    return json(req, { error: 'url_panel_invalida' }, 400)
  }

  const upstreamHeaders = new Headers()
  for (const h of PASS_REQ_HEADERS) {
    const v = req.headers.get(h)
    if (v) upstreamHeaders.set(h, v)
  }
  // Solo reenviar al panel las cookies prefijadas de ESTE panel (sin credenciales del hub)
  const prefix = `spp_${panelId.replace(/-/g, '').slice(0, 8)}_`
  const upstreamCookies = Object.entries(cookies)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => `${k.slice(prefix.length)}=${v}`)
  if (upstreamCookies.length > 0) upstreamHeaders.set('Cookie', upstreamCookies.join('; '))

  let body: ArrayBuffer | undefined
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    body = await req.arrayBuffer()
    if (body.byteLength === 0) body = undefined
  }

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual',
    })
  } catch {
    return json(req, { error: 'panel_no_accesible', detail: `No se pudo contactar con ${upstreamUrl.origin}` }, 502)
  }

  const resHeaders = new Headers()
  for (const h of PASS_RES_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) resHeaders.set(h, v)
  }
  for (const [k, v] of Object.entries(corsFor(req))) resHeaders.set(k, v)

  const panelOrigin = (() => {
    try {
      return new URL(panel.url).origin
    } catch {
      return ''
    }
  })()

  const loc = upstream.headers.get('Location')
  if (loc) resHeaders.set('Location', rewriteLocation(loc, panelOrigin, proxyPrefix, panelId))

  const setCookies =
    typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : upstream.headers.get('Set-Cookie')
        ? [upstream.headers.get('Set-Cookie') as string]
        : []
  for (const sc of setCookies) resHeaders.append('Set-Cookie', rewriteSetCookie(sc, panelId))

  const contentType = resHeaders.get('Content-Type') ?? ''
  if (contentType.includes('text/html')) {
    const html = await upstream.text()
    return new Response(rewriteHtml(html, proxyPrefix, panelId), {
      status: upstream.status,
      headers: resHeaders,
    })
  }

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
})
