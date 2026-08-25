-- ============================================================================
-- SuperPanel · Esquema del hub (ADITIVO: todo con prefijo/super_ para no
-- tocar objetos existentes del proyecto).
-- Cada usuario gestiona SUS paneles y SUS credenciales (modelo personal).
-- Requiere: secreto de Vault 'superpaneles_key' creado ANTES del primer uso:
--   select vault.create_secret('<secreto-largo-aleatorio>', 'superpaneles_key');
-- ============================================================================

create extension if not exists pgcrypto;

-- Esquema de aplicación (cifrado interno, no llamable por clientes) ----------
create schema if not exists superpaneles;

create or replace function superpaneles.key() returns text
language sql security definer set search_path = vault, public
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'superpaneles_key' limit 1; $$;

create or replace function superpaneles.enc(p_plain text) returns bytea
language sql security definer set search_path = public, extensions
as $$ select pgp_sym_encrypt(coalesce(p_plain, ''), superpaneles.key()); $$;

create or replace function superpaneles.dec(p_cipher bytea) returns text
language sql security definer set search_path = public, extensions
as $$ select pgp_sym_decrypt(p_cipher, superpaneles.key()); $$;

revoke execute on function superpaneles.key() from public, anon, authenticated;
revoke execute on function superpaneles.enc(text) from public, anon, authenticated;
revoke execute on function superpaneles.dec(bytea) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Tablas (prefijo super_)
-- ----------------------------------------------------------------------------
create table if not exists public.super_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'user' check (role in ('superadmin','user')),
  created_at timestamptz not null default now()
);

-- Catálogo PERSONAL de paneles: cada usuario añade los paneles a los que
-- tiene acceso (propios con auto-login o de terceros).
create table if not exists public.super_panels (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  url               text not null,
  kind              text not null check (kind in ('own','third')),
  logo_url          text,
  notes             text,
  sort_order        int not null default 0,
  supabase_url      text null,        -- solo kind='own'
  supabase_anon_key text null,        -- solo kind='own' (clave pública)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint super_panels_own_need_supabase
    check (kind <> 'own' or (supabase_url is not null and supabase_anon_key is not null))
);

create index if not exists idx_super_panels_owner on public.super_panels (owner_id);

create table if not exists public.super_panel_credentials (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references public.super_panels(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  label        text not null,
  username     text not null,
  password_enc bytea not null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_super_panel_credentials_panel on public.super_panel_credentials (panel_id);
create index if not exists idx_super_panel_credentials_owner on public.super_panel_credentials (owner_id);

-- La columna cifrada nunca se expone por SELECT a clientes (solo vía RPC)
revoke select (password_enc) on public.super_panel_credentials from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: crear perfil del hub automáticamente al registrar un usuario
-- (nombre super_* para coexistir con otros triggers existentes en auth.users)
-- ----------------------------------------------------------------------------
create or replace function public.super_handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.super_profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists super_on_auth_user_created on auth.users;
create trigger super_on_auth_user_created
  after insert on auth.users
  for each row execute function public.super_handle_new_user();

-- ----------------------------------------------------------------------------
-- RPCs de aplicación (prefijo super_)
-- ----------------------------------------------------------------------------

-- Alta/edición de paneles del propio usuario (owner_id lo fija el servidor).
create or replace function public.super_upsert_panel(
  p_id               uuid default null,
  p_name             text default null,
  p_url              text default null,
  p_kind             text default null,
  p_logo_url         text default null,
  p_notes            text default null,
  p_sort_order       int  default 0,
  p_supabase_url     text default null,
  p_supabase_anon_key text default null
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
    insert into public.super_panels (owner_id, name, url, kind, logo_url, notes, sort_order, supabase_url, supabase_anon_key)
    values (
      auth.uid(), p_name, p_url, p_kind, p_logo_url, p_notes, coalesce(p_sort_order, 0),
      case when p_kind = 'own' then p_supabase_url end,
      case when p_kind = 'own' then p_supabase_anon_key end
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

-- Devuelve la contraseña en claro SOLO al propietario
-- (o a la service_role, usada por la edge function panel-login).
create or replace function public.super_reveal_credential(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  select owner_id, superpaneles.dec(password_enc) as pw
  into v_rec
  from public.super_panel_credentials where id = p_id;

  if v_rec is null then
    return null;
  end if;

  if v_rec.owner_id <> auth.uid()
     and current_setting('request.jwt.claims', true)::json->>'role' <> 'service_role' then
    raise exception 'Sin acceso a esta credencial';
  end if;

  return v_rec.pw;
end;
$$;

-- Inserta/actualiza credenciales cifrando la contraseña en el servidor.
create or replace function public.super_upsert_credential(
  p_id       uuid default null,
  p_panel_id uuid default null,
  p_label    text default null,
  p_username text default null,
  p_password text default null,
  p_notes    text default null
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere sesión';
  end if;

  if p_id is null then
    if p_panel_id is null or coalesce(p_label,'') = '' or coalesce(p_username,'') = '' or coalesce(p_password,'') = '' then
      raise exception 'Faltan datos obligatorios (panel, etiqueta, usuario, contraseña)';
    end if;
    -- El panel debe ser del propio usuario
    if not exists (select 1 from public.super_panels where id = p_panel_id and owner_id = auth.uid()) then
      raise exception 'Panel no encontrado o ajeno';
    end if;
    insert into public.super_panel_credentials (panel_id, owner_id, label, username, password_enc, notes)
    values (p_panel_id, auth.uid(), p_label, p_username, superpaneles.enc(p_password), p_notes)
    returning id into v_id;
  else
    update public.super_panel_credentials set
      label       = coalesce(p_label, label),
      username    = coalesce(p_username, username),
      password_enc = case when coalesce(p_password,'') = '' then password_enc else superpaneles.enc(p_password) end,
      notes       = coalesce(p_notes, notes),
      updated_at  = now()
    where id = p_id and owner_id = auth.uid();
    if not found then
      raise exception 'Credencial no encontrada o ajena';
    end if;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.super_upsert_panel(uuid,text,text,text,text,text,int,text,text) to authenticated;
grant execute on function public.super_reveal_credential(uuid) to authenticated, service_role;
grant execute on function public.super_upsert_credential(uuid,uuid,text,text,text,text) to authenticated;

-- ============================================================================
-- Row Level Security (todo es personal: owner_id = auth.uid())
-- ============================================================================
alter table public.super_profiles          enable row level security;
alter table public.super_panels            enable row level security;
alter table public.super_panel_credentials enable row level security;

-- super_profiles: cada uno ve/edita su fila
drop policy if exists "super_profiles_select" on public.super_profiles;
create policy "super_profiles_select" on public.super_profiles
  for select using (id = auth.uid());
drop policy if exists "super_profiles_update_self" on public.super_profiles;
create policy "super_profiles_update_self" on public.super_profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- super_panels: CRUD completo del propietario (catálogo personal)
drop policy if exists "super_panels_owner_all" on public.super_panels;
create policy "super_panels_owner_all" on public.super_panels
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- super_panel_credentials: CRUD completo del propietario
drop policy if exists "super_panel_credentials_owner_all" on public.super_panel_credentials;
create policy "super_panel_credentials_owner_all" on public.super_panel_credentials
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
