-- ============================================================================
-- SuperPanel · Personalización: caché global de logos, ajustes de marca y
-- estilo de menú por usuario (top / side / dock)
-- ============================================================================

-- 1. Caché global de logos por dominio: cuando un usuario registra un panel,
--    su logo se detecta automáticamente y queda disponible para los demás.
create table if not exists public.super_panel_logos (
  domain     text primary key,
  logo_url   text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.super_panel_logos enable row level security;

drop policy if exists "super_panel_logos_select" on public.super_panel_logos;
create policy "super_panel_logos_select" on public.super_panel_logos
  for select using (auth.role() = 'authenticated');

-- Solo superadmins editan/añaden/borran la caché de logos
drop policy if exists "super_panel_logos_admin_all" on public.super_panel_logos;
create policy "super_panel_logos_admin_all" on public.super_panel_logos
  for all using (public.super_is_superadmin()) with check (public.super_is_superadmin());

-- 2. Ajustes de personalización del hub (fila única id=1)
create table if not exists public.super_settings (
  id                 int primary key default 1 check (id = 1),
  site_name          text not null default 'SuperPanel',
  default_menu_style text not null default 'dock' check (default_menu_style in ('top','side','dock')),
  updated_at         timestamptz not null default now()
);

insert into public.super_settings (id) values (1) on conflict (id) do nothing;

alter table public.super_settings enable row level security;

-- Lectura pública (solo contiene el nombre y el estilo por defecto)
drop policy if exists "super_settings_select" on public.super_settings;
create policy "super_settings_select" on public.super_settings
  for select using (true);

drop policy if exists "super_settings_admin_update" on public.super_settings;
create policy "super_settings_admin_update" on public.super_settings
  for update using (public.super_is_superadmin()) with check (public.super_is_superadmin());

-- 3. Estilo de menú preferido por usuario (null = usar el por defecto del hub)
alter table public.super_profiles
  add column if not exists menu_style text check (menu_style in ('top','side','dock'));

-- 4. RPC para cachear el logo detectado automáticamente (el primero gana;
--    un superadmin puede corregirlo después desde Personalización)
create or replace function public.super_cache_panel_logo(p_domain text, p_logo_url text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_domain text;
begin
  if auth.uid() is null then
    raise exception 'Se requiere sesión';
  end if;

  v_domain := lower(trim(p_domain));
  if v_domain = '' or coalesce(p_logo_url, '') = '' then
    return;
  end if;

  insert into public.super_panel_logos (domain, logo_url, updated_by)
  values (v_domain, p_logo_url, auth.uid())
  on conflict (domain) do nothing;
end;
$$;

grant execute on function public.super_cache_panel_logo(text, text) to authenticated;
