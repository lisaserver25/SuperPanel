// ============================================================================
// admin-users: gestión de usuarios del hub SOLO para superadmins.
// Body: { action: 'list' | 'create' | 'update' | 'set_password' | 'delete', ... }
// - list: usuarios del hub (los que tienen super_profiles, sin anónimos)
// - create: { email, password, full_name?, role? } → createUser (confirmado)
// - update: { id, full_name?, role? }
// - set_password: { id, password }
// - delete: { id }  (nunca a uno mismo; nunca al último superadmin)
// ============================================================================
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

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

interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  role: 'superadmin' | 'user'
  created_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'unauthorized' }, 401)

  const admin = adminClient()
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json({ error: 'unauthorized' }, 401)

  const { data: callerProfile } = await admin
    .from('super_profiles')
    .select('role')
    .eq('id', caller.user.id)
    .maybeSingle()
  if (callerProfile?.role !== 'superadmin') return json({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch (_e) {
    return json({ error: 'body_invalido' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    // ------------------------------------------------------------------ list
    if (action === 'list') {
      const profiles: ProfileRow[] = []
      let page = 1
      const perPage = 200
      const usersById = new Map<string, User>()
      // auth.users del proyecto (paginado); nos quedamos con los del hub
      for (let i = 0; i < 10; i++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
        if (error) throw error
        for (const u of data.users) {
          if ((u as User & { is_anonymous?: boolean }).is_anonymous) continue
          if (!u.email) continue
          usersById.set(u.id, u)
        }
        if (data.users.length < perPage) break
        page += 1
      }
      const { data: rows, error: pErr } = await admin
        .from('super_profiles')
        .select('id, email, full_name, role, created_at')
        .order('created_at', { ascending: true })
      if (pErr) throw pErr
      for (const r of rows ?? []) {
        const u = usersById.get(r.id)
        if (!u) continue // perfil huérfano (usuario borrado en auth) → ignorar
        profiles.push({
          id: r.id,
          email: r.email ?? u.email ?? '',
          full_name: r.full_name,
          role: r.role,
          created_at: r.created_at,
        })
      }
      return json({
        users: profiles.map((p) => {
          const u = usersById.get(p.id)!
          return { ...p, last_sign_in_at: u.last_sign_in_at ?? null, banned: u.banned ?? false }
        }),
      })
    }

    // ---------------------------------------------------------------- create
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const fullName = body.full_name == null ? null : String(body.full_name).trim()
      const role = body.role === 'superadmin' ? 'superadmin' : 'user'
      if (!email || !email.includes('@')) return json({ error: 'email_invalido' }, 400)
      if (password.length < 6) return json({ error: 'contraseña_mínimo_6_caracteres' }, 400)

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // sin verificación por correo
        user_metadata: fullName ? { full_name: fullName } : undefined,
      })
      if (cErr) return json({ error: 'no_se_pudo_crear', detail: cErr.message }, 400)

      // El trigger crea el profile con rol 'user'; ajustamos si es superadmin
      if (role === 'superadmin') {
        const { error: rErr } = await admin
          .from('super_profiles')
          .update({ role: 'superadmin' })
          .eq('id', created.user.id)
        if (rErr) throw rErr
      }
      return json({ id: created.user.id, email, role })
    }

    // ---------------------------------------------------------------- update
    if (action === 'update') {
      const id = String(body.id ?? '')
      if (!id) return json({ error: 'id_requerido' }, 400)
      if (id === caller.user.id && body.role === 'user') {
        return json({ error: 'no_puedes_quitarte_el_rol_superadmin' }, 400)
      }
      const fullName = body.full_name == null ? null : String(body.full_name).trim()
      const role = body.role === 'superadmin' ? 'superadmin' : body.role === 'user' ? 'user' : null

      // Evitar quedarse sin superadmins
      if (role === 'user') {
        const { data: target } = await admin.from('super_profiles').select('role').eq('id', id).maybeSingle()
        if (target?.role === 'superadmin') {
          const { count } = await admin
            .from('super_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'superadmin')
          if ((count ?? 0) <= 1) return json({ error: 'debe_quedar_al_menos_un_superadmin' }, 400)
        }
      }

      if (fullName != null) {
        const { error: mErr } = await admin.auth.admin.updateUserById(id, {
          user_metadata: { full_name: fullName },
        })
        if (mErr) throw mErr
      }
      const patch: Record<string, unknown> = {}
      if (fullName != null) patch.full_name = fullName || null
      if (role) patch.role = role
      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await admin.from('super_profiles').update(patch).eq('id', id)
        if (uErr) throw uErr
      }
      return json({ ok: true })
    }

    // ---------------------------------------------------------- set_password
    if (action === 'set_password') {
      const id = String(body.id ?? '')
      const password = String(body.password ?? '')
      if (!id) return json({ error: 'id_requerido' }, 400)
      if (password.length < 6) return json({ error: 'contraseña_mínimo_6_caracteres' }, 400)
      const { error: pErr } = await admin.auth.admin.updateUserById(id, { password })
      if (pErr) return json({ error: 'no_se_pudo_actualizar', detail: pErr.message }, 400)
      return json({ ok: true })
    }

    // ---------------------------------------------------------------- delete
    if (action === 'delete') {
      const id = String(body.id ?? '')
      if (!id) return json({ error: 'id_requerido' }, 400)
      if (id === caller.user.id) return json({ error: 'no_puedes_eliminar_tu_propia_cuenta' }, 400)
      const { data: target } = await admin.from('super_profiles').select('role').eq('id', id).maybeSingle()
      if (target?.role === 'superadmin') {
        const { count } = await admin
          .from('super_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'superadmin')
        if ((count ?? 0) <= 1) return json({ error: 'debe_quedar_al_menos_un_superadmin' }, 400)
      }
      const { error: dErr } = await admin.auth.admin.deleteUser(id)
      if (dErr) return json({ error: 'no_se_pudo_eliminar', detail: dErr.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'accion_desconocida' }, 400)
  } catch (err) {
    return json({ error: 'error_interno', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})
