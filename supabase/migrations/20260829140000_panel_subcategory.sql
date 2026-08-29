-- ============================================================================
-- SuperPanel · Subservicios: dentro de una categoría (Servicio Global,
-- ej. "cuentagotas") los paneles se clasifican por subservicio
-- (Plex, Emby, Jellyfin, Datacenter, IPTV, Music…).
-- ============================================================================

alter table public.super_panels add column if not exists subcategory text;

-- Backfill: deducir el subservicio del tag entre corchetes del nombre
-- (ej. "CARACOL [Plex]" → subcategory = "Plex")
update public.super_panels
set subcategory = substring(name from '\[([^]]+)\]')
where subcategory is null
  and name ~ '\[[^]]+\]';

-- La RPC de alta/edición también gestiona el subservicio
create or replace function public.super_upsert_panel(
  p_id               uuid default null,
  p_name             text default null,
  p_url              text default null,
  p_kind             text default null,
  p_logo_url         text default null,
  p_notes            text default null,
  p_sort_order       int  default 0,
  p_supabase_url     text default null,
  p_supabase_anon_key text default null,
  p_category         text default null,
  p_subcategory      text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere sesión';
  end if;

  if p_id is null then
    if coalesce(p_name, '') = '' or coalesce(p_url, '') = '' or coalesce(p_kind, '') not in ('own','third') then
      raise exception 'Datos de panel incompletos';
    end if;
    insert into public.super_panels (owner_id, name, url, kind, logo_url, notes, sort_order, supabase_url, supabase_anon_key, category, subcategory)
    values (
      auth.uid(), p_name, p_url, p_kind, p_logo_url, p_notes, coalesce(p_sort_order, 0),
      case when p_kind = 'own' then p_supabase_url end,
      case when p_kind = 'own' then p_supabase_anon_key end,
      coalesce(p_category, 'General'),
      coalesce(p_subcategory, 'General')
    )
    returning id into v_id;
  else
    update public.super_panels set
      name       = coalesce(p_name, name),
      url        = coalesce(p_url, url),
      kind       = coalesce(p_kind, kind),
      logo_url   = p_logo_url,
      notes      = p_notes,
      sort_order = coalesce(p_sort_order, sort_order),
      supabase_url      = case when coalesce(p_kind, kind) = 'own' then p_supabase_url else null end,
      supabase_anon_key = case when coalesce(p_kind, kind) = 'own' then p_supabase_anon_key else null end,
      category   = coalesce(p_category, category),
      subcategory = coalesce(p_subcategory, subcategory),
      updated_at = now()
    where id = p_id and owner_id = auth.uid();
    if not found then
      raise exception 'Panel no encontrado o ajeno';
    end if;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;
