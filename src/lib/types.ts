export type PanelKind = 'own' | 'third'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'superadmin' | 'user'
  created_at: string
}

export interface Panel {
  id: string
  owner_id: string
  name: string
  url: string
  kind: PanelKind
  logo_url: string | null
  notes: string | null
  sort_order: number
  supabase_url: string | null
  supabase_anon_key: string | null
  created_at: string
  updated_at: string
}

// password_enc nunca se selecciona desde el cliente
export interface PanelCredential {
  id: string
  panel_id: string
  owner_id: string
  label: string
  username: string
  notes: string | null
  created_at: string
  updated_at: string
}
