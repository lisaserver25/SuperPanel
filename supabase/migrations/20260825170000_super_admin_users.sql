-- ============================================================================
-- SuperPanel · Gestión de usuarios por superadmin (comercialización)
-- - Rol 'user' = cliente (visualizado como "Cliente")
-- - Solo superadmins administran usuarios (vía edge function admin-users)
-- - Nuevo registro público DESACTIVADO en Auth config del proyecto
-- ============================================================================

-- Helper: ¿el llamante es superadmin del hub?
create or replace function public.super_is_superadmin()
returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from public.super_profiles where id = auth.uid() and role = 'superadmin'); $$;

grant execute on function public.super_is_superadmin() to authenticated;

-- Los superadmins pueden ver todos los perfiles del hub (gestión de usuarios)
drop policy if exists "super_profiles_superadmin_select" on public.super_profiles;
create policy "super_profiles_superadmin_select" on public.super_profiles
  for select using (public.super_is_superadmin());
