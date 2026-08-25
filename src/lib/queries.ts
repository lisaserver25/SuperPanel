import { supabase } from './supabase'
import type { Panel, PanelCredential, Profile } from './types'

const PANEL_COLUMNS =
  'id, owner_id, name, url, kind, logo_url, notes, sort_order, supabase_url, supabase_anon_key, created_at, updated_at'

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
  const { data, error } = await supabase
    .from('super_panels')
    .select(PANEL_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Panel[]
}

export async function fetchPanel(id: string): Promise<Panel | null> {
  const { data, error } = await supabase.from('super_panels').select(PANEL_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Panel | null) ?? null
}

// RLS: solo devuelve las credenciales del propio usuario
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
    // functions.invoke no siempre trae el detalle; leer el cuerpo si existe
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

// --- paneles (catálogo personal: RLS owner-only + RPC que fija owner_id) ---

export async function savePanel(
  panel: Partial<Panel> & { name: string; url: string; kind: 'own' | 'third' }
): Promise<string> {
  const { data, error } = await supabase.rpc('super_upsert_panel', {
    p_id: panel.id ?? null,
    p_name: panel.name,
    p_url: panel.url,
    p_kind: panel.kind,
    p_logo_url: panel.logo_url ?? null,
    p_notes: panel.notes ?? null,
    p_sort_order: panel.sort_order ?? 0,
    p_supabase_url: panel.kind === 'own' ? panel.supabase_url || null : null,
    p_supabase_anon_key: panel.kind === 'own' ? panel.supabase_anon_key || null : null,
  })
  if (error) throw error
  return data as string
}

export async function deletePanel(id: string): Promise<void> {
  const { error } = await supabase.from('super_panels').delete().eq('id', id)
  if (error) throw error
}
