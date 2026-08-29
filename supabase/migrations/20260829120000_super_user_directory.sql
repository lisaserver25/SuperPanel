-- ============================================================================
-- SuperPanel · Directorio de usuarios del hub para invitaciones/compartir
-- Devuelve (id, email, nombre, rol) a cualquier usuario autenticado, para que
-- pueda seleccionar a quién comparte sus paneles (uno o varios).
-- ============================================================================

create or replace function public.super_user_directory()
returns table (id uuid, email text, full_name text, role text)
language sql security definer set search_path = public stable
as $$
  select p.id, p.email, p.full_name, p.role
  from public.super_profiles p
  where coalesce(p.email, '') <> ''
  order by (p.role = 'superadmin') desc, p.email asc;
$$;

grant execute on function public.super_user_directory() to authenticated;
