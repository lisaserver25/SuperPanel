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
  category: string
  supabase_url: string | null
  supabase_anon_key: string | null
  created_at: string
  updated_at: string
  // Propiedades opcionales calculadas en frontend / joins
  is_shared?: boolean
  shared_by_email?: string
  shared_by_name?: string
  share_id?: string
  custom_category?: string
  owner_email?: string
  // Usuarios con los que el propietario ha compartido este panel
  shared_with_users?: { email: string; status: 'pending' | 'accepted' | 'rejected' }[]
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

export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  role: 'superadmin' | 'user'
  created_at: string
  last_sign_in_at: string | null
  banned: boolean
}

export type CollaborationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled'

export interface Collaboration {
  id: string
  sender_id: string
  receiver_email: string
  receiver_id: string | null
  status: CollaborationStatus
  sender_email?: string
  sender_name?: string
  receiver_name?: string
  created_at: string
  updated_at: string
}

export type PanelShareStatus = 'pending' | 'accepted' | 'rejected'

export interface PanelShare {
  id: string
  panel_id: string
  shared_by: string
  shared_with_email: string
  shared_with_id: string | null
  custom_category: string
  status: PanelShareStatus
  created_at: string
  updated_at: string
  panel?: Panel
  shared_by_email?: string
  shared_by_name?: string
}

export interface TabItem {
  id: string
  title: string
  path: string
  panelId?: string
  kind?: PanelKind
  logo_url?: string | null
  category?: string
  closable?: boolean
}
