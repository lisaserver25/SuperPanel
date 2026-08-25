// ============================================================================
// panel-login: login programático contra el Supabase de un panel propio o compartido.
// Entrada:  { credential_id }
// Salida:   { access_token, refresh_token, expires_at, expires_in }
// Seguridad: verify_jwt=true; el dueño de la credencial o usuarios con acceso
// al panel compartido aceptado pueden usarla.
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

interface PanelRow {
  id: string
  name: string
  kind: string
  supabase_url: string | null
  supabase_anon_key: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
  try {
    const body = (await req.json()) as { credential_id?: string }
    credentialId = body.credential_id ?? ''
  } catch (_e) {
    return json({ error: 'body_invalido' }, 400)
  }
  if (!credentialId) return json({ error: 'credential_id_requerido' }, 400)

  const { data: cred, error: credError } = await admin
    .from('super_panel_credentials')
    .select('id, owner_id, panel_id, username, super_panels(id, name, kind, supabase_url, supabase_anon_key)')
    .eq('id', credentialId)
    .maybeSingle()
  if (credError || !cred) return json({ error: 'credential_not_found' }, 404)

  // Comprobar si el usuario es dueño de la credencial O tiene el panel compartido aceptado
  const isOwner = cred.owner_id === user.id
  let isSharedUser = false

  if (!isOwner && cred.panel_id) {
    const userEmail = (user.email ?? '').toLowerCase()
    const { data: share } = await admin
      .from('super_panel_shares')
      .select('id')
      .eq('panel_id', cred.panel_id)
      .eq('status', 'accepted')
      .or(`shared_with_id.eq.${user.id},shared_with_email.ilike.${userEmail}`)
      .maybeSingle()
    if (share) isSharedUser = true
  }

  if (!isOwner && !isSharedUser) return json({ error: 'forbidden' }, 403)

  const panel = (cred.super_panels ?? null) as PanelRow | null
  if (!panel || panel.kind !== 'own' || !panel.supabase_url || !panel.supabase_anon_key) {
    return json({ error: 'panel_sin_supabase', detail: 'El panel no está configurado para auto-login' }, 400)
  }

  // Descifrado vía SECURITY DEFINER (la función deja pasar a service_role)
  const { data: password, error: revealError } = await admin.rpc('super_reveal_credential', { p_id: cred.id })
  if (revealError || !password) return json({ error: 'no_se_pudo_descifrar' }, 500)

  // Login programático contra el Supabase DEL PANEL (clave anon = pública)
  const tokenUrl = `${panel.supabase_url.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`
  const upstream = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      apikey: panel.supabase_anon_key,
      Authorization: `Bearer ${panel.supabase_anon_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: cred.username, password }),
  })

  const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
  if (!upstream.ok) {
    const detail =
      (payload.error_description as string | undefined) ??
      (payload.msg as string | undefined) ??
      (payload.error_code as string | undefined) ??
      `HTTP ${upstream.status}`
    return json({ error: 'login_panel_invalido', detail }, 401)
  }

  const accessToken = payload.access_token as string | undefined
  const refreshToken = payload.refresh_token as string | undefined
  if (!accessToken || !refreshToken) {
    return json({ error: 'login_panel_invalido', detail: 'El panel no devolvió tokens' }, 401)
  }

  return json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: payload.expires_at ?? null,
    expires_in: payload.expires_in ?? null,
  })
})
