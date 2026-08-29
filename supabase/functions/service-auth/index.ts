// ============================================================================
// service-auth: login automático en servicios de terceros (Plex).
// Modos:
//   { service: 'plex', credential_id }                          → signin por credencial
//   { service: 'plex', mode: 'pin-start' }                       → crea PIN (id + code)
//   { service: 'plex', mode: 'pin-check', pin_id, code }         → comprueba el PIN
// El flujo PIN es el enlace de auth oficial de Plex:
//   el usuario abre https://app.plex.tv/auth#?clientID=…&code=…  y, al iniciar
//   sesión ahí, el navegador queda autenticado para app.plex.tv/desktop.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('HUB_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PLEX_CLIENT_IDENTIFIER = 'b1a7f2c4-0000-4a5b-8c9d-superpanel01'

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false } })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function plexSignin(login: string, password: string): Promise<{ ok: boolean; token?: string; detail?: string }> {
  const resp = await fetch('https://plex.tv/api/v2/users/signin', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      'X-Plex-Product': 'SuperPanel',
      'X-Plex-Version': '1.0',
    },
    body: new URLSearchParams({ login, password }),
  })
  if (!resp.ok) {
    let detail = `plex.tv HTTP ${resp.status}`
    try {
      const payload = (await resp.json()) as { errors?: { message?: string }[] }
      detail = payload?.errors?.map((e) => e.message).join(', ') || detail
    } catch {
      /* ignore */
    }
    return { ok: false, detail }
  }
  const payload = (await resp.json()) as { authToken?: string }
  if (!payload.authToken) return { ok: false, detail: 'plex.tv no devolvió authToken' }
  return { ok: true, token: payload.authToken }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'unauthorized' }, 401)

  const admin = adminClient()
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'unauthorized' }, 401)

  let credentialId = ''
  let service = 'plex'
  let mode = 'signin'
  let pinId = 0
  let pinCode = ''
  try {
    const body = (await req.json()) as { credential_id?: string; service?: string; mode?: string; pin_id?: number; code?: string }
    credentialId = body.credential_id ?? ''
    service = (body.service ?? 'plex').toLowerCase()
    mode = body.mode ?? 'signin'
    pinId = Number(body.pin_id ?? 0)
    pinCode = body.code ?? ''
  } catch (_e) {
    return json({ error: 'body_invalido' }, 400)
  }
  if (service !== 'plex') return json({ error: 'servicio_no_soportado' }, 400)

  // ---- Flujo PIN (enlace de auth oficial de Plex) ----
  if (mode === 'pin-start') {
    const resp = await fetch('https://plex.tv/api/v2/pins?strong=true', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': 'SuperPanel',
      },
    })
    if (!resp.ok) return json({ error: 'pin_error', detail: `plex.tv HTTP ${resp.status}` }, 502)
    const payload = (await resp.json()) as { id: number; code: string }
    return json({
      pin_id: payload.id,
      code: payload.code,
      client_id: PLEX_CLIENT_IDENTIFIER,
      auth_url: `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_IDENTIFIER}&code=${payload.code}`,
    })
  }

  if (mode === 'pin-check') {
    if (!pinId || !pinCode) return json({ error: 'pin_faltante' }, 400)
    const resp = await fetch(
      `https://plex.tv/api/v2/pins/${pinId}?code=${encodeURIComponent(pinCode)}`,
      { headers: { Accept: 'application/json', 'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER } }
    )
    if (!resp.ok) return json({ error: 'pin_error', detail: `plex.tv HTTP ${resp.status}` }, 502)
    const payload = (await resp.json()) as { authToken?: string }
    if (payload.authToken) return json({ status: 'authorized', auth_token: payload.authToken })
    return json({ status: 'pending' })
  }

  // ---- Flujo signin por credencial ----
  if (!credentialId) return json({ error: 'credential_id_requerido' }, 400)

  const { data: cred, error: credError } = await admin
    .from('super_panel_credentials')
    .select('id, owner_id, username, super_panels(url, subcategory)')
    .eq('id', credentialId)
    .maybeSingle()
  if (credError || !cred) return json({ error: 'credential_not_found' }, 404)

  // Solo el dueño de la credencial
  if (cred.owner_id !== user.id) return json({ error: 'forbidden' }, 403)

  const { data: password, error: revealError } = await admin.rpc('super_reveal_credential', { p_id: cred.id })
  if (revealError || !password) return json({ error: 'no_se_pudo_descifrar' }, 500)

  const signin = await plexSignin(cred.username, password)
  if (!signin.ok || !signin.token) {
    return json({ error: 'login_plex_invalido', detail: signin.detail }, 401)
  }

  return json({ provider: 'plex', auth_token: signin.token })
})
