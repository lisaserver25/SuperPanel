-- ============================================================================
-- SuperPanel · Personalización de apariencia: modo de tema y color de acento
-- (por usuario + por defecto del hub gestionado por superadmin)
-- ============================================================================

alter table public.super_profiles
  add column if not exists theme_mode text check (theme_mode in ('dark','light','system')),
  add column if not exists accent text check (accent in ('sky','violet','emerald','amber','rose','cyan'));

alter table public.super_settings
  add column if not exists default_theme_mode text not null default 'dark' check (default_theme_mode in ('dark','light','system')),
  add column if not exists default_accent text not null default 'sky' check (default_accent in ('sky','violet','emerald','amber','rose','cyan'));
