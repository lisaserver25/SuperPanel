import { supabase } from './supabase'
import type { AdminUser, Collaboration, Panel, PanelCredential, PanelShare, Profile } from './types'

const CRED_COLUMNS = 'id, panel_id, owner_id, label, username, notes, created_at, updated_at'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('super_profiles')
    .select('id, email, full_name, role, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as Profile | null) ?? null
}

export async function fetchPanels(): Promise<Panel[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // 1. Obtener paneles accesibles (propios + compartidos)
  const { data: rawPanels, error } = await supabase
    .from('super_panels')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error

  const panels = (rawPanels ?? []) as Panel[]
  if (panels.length === 0) return []

  // 2. Obtener shares aceptados del usuario actual para enriquecer categorías personalizadas
  const sharesMap = new Map<string, { shareId: string; customCategory: string; sharedBy: string }>()
  try {
    const { data: myShares, error: sharesError } = await supabase
      .from('super_panel_shares')
      .select('id, panel_id, shared_by, custom_category, status')
      .eq('status', 'accepted')

    if (!sharesError && myShares) {
      for (const s of myShares) {
        if (s.shared_by !== user.id) {
          sharesMap.set(s.panel_id, {
            shareId: s.id,
            customCategory: s.custom_category || 'General',
            sharedBy: s.shared_by,
          })
        }
      }
    }
  } catch {
    // Si la tabla de shares no existe todavía en la BD remota, continuar
  }

  // 3. Obtener perfiles de propietarios si hay paneles compartidos
  const ownerIds = Array.from(new Set(panels.filter((p) => p.owner_id !== user.id).map((p) => p.owner_id)))
  const profileMap = new Map<string, string>()
  if (ownerIds.length > 0) {
    try {
      const { data: profiles } = await supabase
        .from('super_profiles')
        .select('id, email, full_name')
        .in('id', ownerIds)
      if (profiles) {
        for (const pr of profiles) {
          profileMap.set(pr.id, pr.full_name ? `${pr.full_name} (${pr.email})` : pr.email)
        }
      }
    } catch {
      /* ignore */
    }
  }

  return panels.map((p) => {
    const isShared = p.owner_id !== user.id
    const shareInfo = sharesMap.get(p.id)
    return {
      ...p,
      category: (isShared && shareInfo?.customCategory ? shareInfo.customCategory : p.category) || 'General',
      is_shared: isShared,
      share_id: shareInfo?.shareId,
      shared_by_name: isShared ? profileMap.get(p.owner_id) ?? undefined : undefined,
    }
  })
}

export async function fetchPanel(id: string): Promise<Panel | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase.from('super_panels').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null

  const p = data as Panel
  if (user && p.owner_id !== user.id) {
    try {
      const { data: share } = await supabase
        .from('super_panel_shares')
        .select('id, custom_category, shared_by')
        .eq('panel_id', id)
        .eq('status', 'accepted')
        .maybeSingle()

      let ownerName: string | undefined
      const { data: profile } = await supabase
        .from('super_profiles')
        .select('email, full_name')
        .eq('id', p.owner_id)
        .maybeSingle()
      if (profile) {
        ownerName = profile.full_name ? `${profile.full_name} (${profile.email})` : profile.email
      }

      return {
        ...p,
        category: share?.custom_category || p.category || 'General',
        is_shared: true,
        share_id: share?.id,
        shared_by_name: ownerName,
      }
    } catch {
      return {
        ...p,
        category: p.category || 'General',
      }
    }
  }

  return {
    ...p,
    category: p.category || 'General',
  }
}

// RLS: solo devuelve las credenciales del propio usuario o accesibles
export async function fetchCredentials(): Promise<PanelCredential[]> {
  const { data, error } = await supabase
    .from('super_panel_credentials')
    .select(CRED_COLUMNS)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as PanelCredential[]
}

export async function upsertCredential(input: {
  id?: string
  panel_id: string
  label: string
  username: string
  password?: string
  notes?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('super_upsert_credential', {
    p_id: input.id ?? null,
    p_panel_id: input.panel_id,
    p_label: input.label,
    p_username: input.username,
    p_password: input.password ?? null,
    p_notes: input.notes ?? null,
  })
  if (error) throw error
  return data as string
}

export async function deleteCredential(id: string): Promise<void> {
  const { error } = await supabase.from('super_panel_credentials').delete().eq('id', id)
  if (error) throw error
}

export async function revealCredential(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('super_reveal_credential', { p_id: id })
  if (error) throw error
  return (data as string) ?? ''
}

export interface PanelLoginTokens {
  access_token: string
  refresh_token: string
  expires_at?: number | null
  expires_in?: number | null
}

export async function panelLogin(credentialId: string): Promise<PanelLoginTokens> {
  const { data, error } = await supabase.functions.invoke<PanelLoginTokens>('panel-login', {
    body: { credential_id: credentialId },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let detail = error.message
    if (ctx) {
      try {
        const body = (await ctx.json()) as { detail?: string; error?: string }
        detail = body.detail ?? body.error ?? detail
      } catch {
        /* ignore */
      }
    }
    throw new Error(detail)
  }
  if (!data?.access_token || !data?.refresh_token) throw new Error('La función no devolvió tokens')
  return data
}

// --- Guardar y Editar Paneles (con soporte RPC y fallback directo) ---

export async function savePanel(
  panel: Partial<Panel> & { name: string; url: string; kind: 'own' | 'third'; category?: string }
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Se requiere sesión')

  const targetCategory = panel.category?.trim() || 'General'

  // 1. Intentar con RPC super_upsert_panel (que gestiona owner_id)
  try {
    const { data, error } = await supabase.rpc('super_upsert_panel', {
      p_id: panel.id ?? null,
      p_name: panel.name.trim(),
      p_url: panel.url.trim(),
      p_kind: panel.kind,
      p_logo_url: panel.logo_url ?? null,
      p_notes: panel.notes ?? null,
      p_sort_order: panel.sort_order ?? 0,
      p_supabase_url: panel.kind === 'own' ? panel.supabase_url || null : null,
      p_supabase_anon_key: panel.kind === 'own' ? panel.supabase_anon_key || null : null,
      p_category: targetCategory,
    })
    if (!error && data) return data as string
  } catch {
    /* fallback directo */
  }

  // 2. Operación directa sobre super_panels si la RPC falla o está desactualizada
  if (panel.id) {
    const updatePayload: Record<string, unknown> = {
      name: panel.name.trim(),
      url: panel.url.trim(),
      kind: panel.kind,
      logo_url: panel.logo_url ?? null,
      notes: panel.notes ?? null,
      sort_order: panel.sort_order ?? 0,
      supabase_url: panel.kind === 'own' ? panel.supabase_url || null : null,
      supabase_anon_key: panel.kind === 'own' ? panel.supabase_anon_key || null : null,
      category: targetCategory,
      updated_at: new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from('super_panels')
      .update(updatePayload)
      .eq('id', panel.id)
      .eq('owner_id', user.id)

    if (updateErr) {
      delete updatePayload.category
      const { error: retryErr } = await supabase
        .from('super_panels')
        .update(updatePayload)
        .eq('id', panel.id)
        .eq('owner_id', user.id)
      if (retryErr) throw retryErr
    }
    return panel.id
  } else {
    const insertPayload: Record<string, unknown> = {
      owner_id: user.id,
      name: panel.name.trim(),
      url: panel.url.trim(),
      kind: panel.kind,
      logo_url: panel.logo_url ?? null,
      notes: panel.notes ?? null,
      sort_order: panel.sort_order ?? 0,
      supabase_url: panel.kind === 'own' ? panel.supabase_url || null : null,
      supabase_anon_key: panel.kind === 'own' ? panel.supabase_anon_key || null : null,
      category: targetCategory,
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('super_panels')
      .insert(insertPayload)
      .select('id')
      .single()

    if (insertErr) {
      delete insertPayload.category
      const { data: retryData, error: retryErr } = await supabase
        .from('super_panels')
        .insert(insertPayload)
        .select('id')
        .single()
      if (retryErr) throw retryErr
      return retryData.id
    }
    return inserted.id
  }
}

export async function deletePanel(id: string): Promise<void> {
  const { error } = await supabase.from('super_panels').delete().eq('id', id)
  if (error) throw error
}

// --- Renombrar y gestionar Categorías ---

export async function renameCategory(oldName: string, newName: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Se requiere sesión')

  const trimmedOld = oldName.trim()
  const trimmedNew = newName.trim()
  if (!trimmedNew) throw new Error('El nuevo nombre de categoría no puede estar vacío')
  if (trimmedOld.toLowerCase() === trimmedNew.toLowerCase()) return

  // 1. Actualizar paneles propios que tengan esta categoría
  try {
    const { error: errPanels } = await supabase
      .from('super_panels')
      .update({ category: trimmedNew, updated_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .eq('category', trimmedOld)
    if (errPanels) {
      console.warn('Advertencia al renombrar paneles propios:', errPanels)
    }
  } catch (e) {
    console.warn(e)
  }

  // 2. Actualizar paneles compartidos del usuario actual con esa categoría
  try {
    const userEmail = (user.email ?? '').toLowerCase()
    await supabase
      .from('super_panel_shares')
      .update({ custom_category: trimmedNew, updated_at: new Date().toISOString() })
      .or(`shared_with_id.eq.${user.id},shared_with_email.ilike.${userEmail}`)
      .eq('custom_category', trimmedOld)
  } catch (e) {
    console.warn(e)
  }
}

// --- Colaboraciones entre usuarios (Conexiones / Invitaciones) ---

export async function fetchCollaborations(): Promise<{
  sent: Collaboration[]
  received: Collaboration[]
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { sent: [], received: [] }

  try {
    const { data, error } = await supabase
      .from('super_collaborations')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error

    const list = (data ?? []) as Collaboration[]

    // Buscar perfiles para nombres
    const userIds = Array.from(
      new Set(list.flatMap((c) => [c.sender_id, c.receiver_id]).filter((id): id is string => !!id))
    )
    const profileMap = new Map<string, { email: string; name: string | null }>()
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('super_profiles')
        .select('id, email, full_name')
        .in('id', userIds)
      if (profiles) {
        for (const p of profiles) {
          profileMap.set(p.id, { email: p.email, name: p.full_name })
        }
      }
    }

    const enriched = list.map((c) => {
      const sender = profileMap.get(c.sender_id)
      const receiver = c.receiver_id ? profileMap.get(c.receiver_id) : null
      return {
        ...c,
        sender_email: sender?.email,
        sender_name: sender?.name ?? undefined,
        receiver_name: receiver?.name ?? undefined,
      }
    })

    return {
      sent: enriched.filter((c) => c.sender_id === user.id),
      received: enriched.filter(
        (c) => c.sender_id !== user.id && (c.receiver_id === user.id || c.receiver_email.toLowerCase() === (user.email ?? '').toLowerCase())
      ),
    }
  } catch {
    return { sent: [], received: [] }
  }
}

export async function sendCollaborationInvite(email: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Se requiere sesión')
  if (email.trim().toLowerCase() === (user.email ?? '').toLowerCase()) {
    throw new Error('No puedes enviarte una invitación a ti mismo')
  }

  const { error } = await supabase.from('super_collaborations').insert({
    sender_id: user.id,
    receiver_email: email.trim().toLowerCase(),
    status: 'pending',
  })
  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya existe una invitación con este correo electrónico')
    }
    throw error
  }
}

export async function respondCollaboration(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase
    .from('super_collaborations')
    .update({ status: accept ? 'accepted' : 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCollaboration(id: string): Promise<void> {
  const { error } = await supabase.from('super_collaborations').delete().eq('id', id)
  if (error) throw error
}

// Lista de colaboradores aceptados (para autocompletar / selector)
export async function fetchAcceptedCollaborators(): Promise<{ email: string; name?: string; userId?: string }[]> {
  const { sent, received } = await fetchCollaborations()
  const map = new Map<string, { email: string; name?: string; userId?: string }>()

  for (const c of sent) {
    if (c.status === 'accepted') {
      map.set(c.receiver_email.toLowerCase(), {
        email: c.receiver_email,
        name: c.receiver_name,
        userId: c.receiver_id ?? undefined,
      })
    }
  }

  for (const c of received) {
    if (c.status === 'accepted' && c.sender_email) {
      map.set(c.sender_email.toLowerCase(), {
        email: c.sender_email,
        name: c.sender_name,
        userId: c.sender_id,
      })
    }
  }

  return Array.from(map.values())
}

// --- Compartición de Paneles ---

export async function fetchPanelShares(panelId: string): Promise<PanelShare[]> {
  try {
    const { data, error } = await supabase
      .from('super_panel_shares')
      .select('*')
      .eq('panel_id', panelId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as PanelShare[]
  } catch {
    return []
  }
}

export async function sharePanel(panelId: string, email: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Se requiere sesión')
  if (email.trim().toLowerCase() === (user.email ?? '').toLowerCase()) {
    throw new Error('No puedes compartir un panel contigo mismo')
  }

  const { error } = await supabase.from('super_panel_shares').insert({
    panel_id: panelId,
    shared_by: user.id,
    shared_with_email: email.trim().toLowerCase(),
    status: 'pending',
    custom_category: 'General',
  })
  if (error) {
    if (error.code === '23505') {
      throw new Error('Este panel ya está compartido con este usuario')
    }
    throw error
  }
}

export async function removePanelShare(shareId: string): Promise<void> {
  const { error } = await supabase.from('super_panel_shares').delete().eq('id', shareId)
  if (error) throw error
}

export async function fetchPendingPanelShares(): Promise<PanelShare[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  try {
    const { data, error } = await supabase
      .from('super_panel_shares')
      .select('*, panel:super_panels(*)')
      .eq('status', 'pending')
    if (error) throw error

    const list = (data ?? []) as (PanelShare & { panel: Panel | null })[]
    const filtered = list.filter(
      (s) => s.shared_by !== user.id && (s.shared_with_id === user.id || s.shared_with_email.toLowerCase() === (user.email ?? '').toLowerCase())
    )

    // Obtener nombres de los que compartieron
    const senderIds = Array.from(new Set(filtered.map((s) => s.shared_by)))
    const profileMap = new Map<string, string>()
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('super_profiles')
        .select('id, email, full_name')
        .in('id', senderIds)
      if (profiles) {
        for (const pr of profiles) {
          profileMap.set(pr.id, pr.full_name ? `${pr.full_name} (${pr.email})` : pr.email)
        }
      }
    }

    return filtered.map((s) => ({
      ...s,
      panel: s.panel ?? undefined,
      shared_by_name: profileMap.get(s.shared_by),
    }))
  } catch {
    return []
  }
}

export async function respondPanelShare(
  shareId: string,
  accept: boolean,
  customCategory = 'General'
): Promise<void> {
  const { error } = await supabase
    .from('super_panel_shares')
    .update({
      status: accept ? 'accepted' : 'rejected',
      custom_category: customCategory.trim() || 'General',
      updated_at: new Date().toISOString(),
    })
    .eq('id', shareId)
  if (error) throw error
}

export async function updatePanelShareCategory(shareId: string, customCategory: string): Promise<void> {
  const { error } = await supabase
    .from('super_panel_shares')
    .update({
      custom_category: customCategory.trim() || 'General',
      updated_at: new Date().toISOString(),
    })
    .eq('id', shareId)
  if (error) throw error
}

// --- gestión de usuarios (solo superadmins, vía edge function admin-users) ---

async function adminUsersCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('admin-users', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let detail = error.message
    if (ctx) {
      try {
        const payload = (await ctx.json()) as { detail?: string; error?: string }
        detail = payload.detail ?? payload.error ?? detail
      } catch {
        /* ignore */
      }
    }
    throw new Error(detail)
  }
  return data as T
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const data = await adminUsersCall<{ users: AdminUser[] }>({ action: 'list' })
  return data?.users ?? []
}

export async function adminCreateUser(input: {
  email: string
  password: string
  full_name?: string
  role: 'superadmin' | 'user'
}): Promise<void> {
  await adminUsersCall({ action: 'create', ...input })
}

export async function adminUpdateUser(input: {
  id: string
  full_name?: string
  role?: 'superadmin' | 'user'
}): Promise<void> {
  await adminUsersCall({ action: 'update', ...input })
}

export async function adminSetPassword(id: string, password: string): Promise<void> {
  await adminUsersCall({ action: 'set_password', id, password })
}

export async function adminDeleteUser(id: string): Promise<void> {
  await adminUsersCall({ action: 'delete', id })
}
