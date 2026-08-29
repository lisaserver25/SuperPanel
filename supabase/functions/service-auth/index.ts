// ============================================================================
// service-auth: login automático en servicios de terceros (Plex).
// Entrada:  { credential_id, service: 'plex' }
// Salida:   { provider: 'plex', auth_token }
// - Verifica JWT y propiedad de la credencial (solo el dueño).
// - Descifra la contraseña vía super_reveal_credential (SECURITY DEFINER).
// - Hace login en plex.tv con la API oficial y devuelve el authToken, que el
//   hub inyecta en la URL del web app del servidor (X-Plex-Token).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('HUB_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

const PLEX_CLIENT_IDENTIFIER = 'b1a7f2c4-0000-4a5b-8c9d-superpanel01'

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
  try {
    const body = (await req.json()) as { credential_id?: string; service?: string }
    credentialId = body.credential_id ?? ''
    service = (body.service ?? 'plex').toLowerCase()
  } catch (_e) {
    return json({ error: 'body_invalido' }, 400)
  }
  if (!credentialId) return json({ error: 'credential_id_requerido' }, 400)
  if (service !== 'plex') return json({ error: 'servicio_no_soportado' }, 400)

  const { data: cred, error: credError } = await admin
    .from('super_panel_credentials')
    .select('id, owner_id, username, super_panels(url, subcategory)')
    .eq('id', credentialId)
    .maybeSingle()
  if (credError || !cred) return json({ error: 'credential_not_found' }, 404)

  // Solo el dueño de la credencial
  if (cred.owner_id !== user.id) return json({ error: 'forbidden' }, 403)

  // La contraseña llega descifrada desde la función SECURITY DEFINER
  const { data: password, error: revealError } = await admin.rpc('super_reveal_credential', { p_id: cred.id })
  if (revealError || !password) return json({ error: 'no_se_pudo_descifrar' }, 500)

  // El acceso a Plex es con el email de la credencial
  const signin = await plexSignin(cred.username, password)
  if (!signin.ok || !signin.token) {
    return json({ error: 'login_plex_invalido', detail: signin.detail }, 401)
  }

  return json({ provider: 'plex', auth_token: signin.token })
})
