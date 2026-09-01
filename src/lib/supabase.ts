import { createClient } from '@supabase/supabase-js'

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!envSupabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[SuperPaneles] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y rellena tus claves.'
  )
}

/** URL base del proyecto Supabase (pública; necesaria para el proxy de paneles XUI) */
export const supabaseUrl: string = envSupabaseUrl ?? ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
