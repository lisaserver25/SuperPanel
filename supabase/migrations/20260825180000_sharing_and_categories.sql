-- ============================================================================
-- SuperPanel · Categorías, Invitaciones entre usuarios y Compartición de Paneles
-- ============================================================================

-- 1. Añadir columna category a public.super_panels
alter table public.super_panels
  add column if not exists category text not null default 'General';

create index if not exists idx_super_panels_category on public.super_panels (category);

-- 2. Actualizar super_upsert_panel para soportar categoría
create or replace function public.super_upsert_panel(
  p_id                uuid default null,
  p_name              text default null,
  p_url               text default null,
  p_kind              text default null,
  p_logo_url          text default null,
  p_notes             text default null,
  p_sort_order        int  default 0,
  p_supabase_url      text default null,
  p_supabase_anon_key text default null,
  p_category          text default 'General'
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
    insert into public.super_panels (
      owner_id, name, url, kind, logo_url, notes, sort_order,
      supabase_url, supabase_anon_key, category
    )
    values (
      auth.uid(), p_name, p_url, p_kind, p_logo_url, p_notes, coalesce(p_sort_order, 0),
      case when p_kind = 'own' then p_supabase_url end,
      case when p_kind = 'own' then p_supabase_anon_key end,
      coalesce(nullif(trim(p_category), ''), 'General')
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
      category   = coalesce(nullif(trim(p_category), ''), category),
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

grant execute on function public.super_upsert_panel(uuid,text,text,text,text,text,int,text,text,text) to authenticated;

-- 3. Tabla de conexiones/invitaciones de colaboración entre usuarios
create table if not exists public.super_collaborations (
  id             uuid primary key default gen_random_uuid(),
  sender_id      uuid not null references auth.users(id) on delete cascade,
  receiver_email text not null,
  receiver_id    uuid references auth.users(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'canceled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint super_collab_sender_receiver_uniq unique (sender_id, receiver_email)
);

create index if not exists idx_super_collaborations_sender on public.super_collaborations (sender_id);
create index if not exists idx_super_collaborations_receiver_id on public.super_collaborations (receiver_id);
create index if not exists idx_super_collaborations_receiver_email on public.super_collaborations (lower(receiver_email));

-- 4. Tabla de paneles compartidos
create table if not exists public.super_panel_shares (
  id                uuid primary key default gen_random_uuid(),
  panel_id          uuid not null references public.super_panels(id) on delete cascade,
  shared_by         uuid not null references auth.users(id) on delete cascade,
  shared_with_email text not null,
  shared_with_id    uuid references auth.users(id) on delete cascade,
  custom_category   text not null default 'General',
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint super_panel_shares_uniq unique (panel_id, shared_with_email)
);

create index if not exists idx_super_panel_shares_panel on public.super_panel_shares (panel_id);
create index if not exists idx_super_panel_shares_by on public.super_panel_shares (shared_by);
create index if not exists idx_super_panel_shares_with_id on public.super_panel_shares (shared_with_id);
create index if not exists idx_super_panel_shares_with_email on public.super_panel_shares (lower(shared_with_email));

-- 5. Vincular receiver_id y shared_with_id automáticamente cuando se inserta o si ya existe el usuario
create or replace function public.super_match_share_recipient()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.receiver_id is null then
    select id into new.receiver_id from public.super_profiles where lower(email) = lower(new.receiver_email) limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists super_trg_match_collab on public.super_collaborations;
create trigger super_trg_match_collab
  before insert or update of receiver_email on public.super_collaborations
  for each row execute function public.super_match_share_recipient();

create or replace function public.super_match_panel_share_recipient()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.shared_with_id is null then
    select id into new.shared_with_id from public.super_profiles where lower(email) = lower(new.shared_with_email) limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists super_trg_match_panel_share on public.super_panel_shares;
create trigger super_trg_match_panel_share
  before insert or update of shared_with_email on public.super_panel_shares
  for each row execute function public.super_match_panel_share_recipient();

-- Al registrarse un usuario, vincular registros pendientes
create or replace function public.super_handle_user_shares_link()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.super_collaborations
    set receiver_id = new.id
    where receiver_id is null and lower(receiver_email) = lower(new.email);

  update public.super_panel_shares
    set shared_with_id = new.id
    where shared_with_id is null and lower(shared_with_email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists super_trg_link_user_shares on public.super_profiles;
create trigger super_trg_link_user_shares
  after insert on public.super_profiles
  for each row execute function public.super_handle_user_shares_link();

-- 6. Actualizar RLS en public.super_panels para permitir que el invitado vea paneles compartidos aceptados
drop policy if exists "super_panels_owner_all" on public.super_panels;
drop policy if exists "super_panels_select" on public.super_panels;
drop policy if exists "super_panels_insert" on public.super_panels;
drop policy if exists "super_panels_update" on public.super_panels;
drop policy if exists "super_panels_delete" on public.super_panels;

create policy "super_panels_select" on public.super_panels
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.super_panel_shares s
      where s.panel_id = public.super_panels.id
        and (s.shared_with_id = auth.uid() or lower(s.shared_with_email) = lower(coalesce(auth.jwt()->>'email', '')))
        and s.status = 'accepted'
    )
  );

create policy "super_panels_insert" on public.super_panels
  for insert with check (owner_id = auth.uid());

create policy "super_panels_update" on public.super_panels
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "super_panels_delete" on public.super_panels
  for delete using (owner_id = auth.uid());

-- 7. RLS para super_collaborations y super_panel_shares
alter table public.super_collaborations enable row level security;
alter table public.super_panel_shares   enable row level security;

-- super_collaborations
drop policy if exists "super_collab_select" on public.super_collaborations;
create policy "super_collab_select" on public.super_collaborations
  for select using (
    sender_id = auth.uid()
    or receiver_id = auth.uid()
    or lower(receiver_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

drop policy if exists "super_collab_insert" on public.super_collaborations;
create policy "super_collab_insert" on public.super_collaborations
  for insert with check (sender_id = auth.uid());

drop policy if exists "super_collab_update" on public.super_collaborations;
create policy "super_collab_update" on public.super_collaborations
  for update using (
    sender_id = auth.uid()
    or receiver_id = auth.uid()
    or lower(receiver_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

drop policy if exists "super_collab_delete" on public.super_collaborations;
create policy "super_collab_delete" on public.super_collaborations
  for delete using (
    sender_id = auth.uid()
    or receiver_id = auth.uid()
    or lower(receiver_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

-- super_panel_shares
drop policy if exists "super_panel_shares_select" on public.super_panel_shares;
create policy "super_panel_shares_select" on public.super_panel_shares
  for select using (
    shared_by = auth.uid()
    or shared_with_id = auth.uid()
    or lower(shared_with_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

drop policy if exists "super_panel_shares_insert" on public.super_panel_shares;
create policy "super_panel_shares_insert" on public.super_panel_shares
  for insert with check (
    shared_by = auth.uid()
    and exists (select 1 from public.super_panels where id = panel_id and owner_id = auth.uid())
  );

drop policy if exists "super_panel_shares_update" on public.super_panel_shares;
create policy "super_panel_shares_update" on public.super_panel_shares
  for update using (
    shared_by = auth.uid()
    or shared_with_id = auth.uid()
    or lower(shared_with_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

drop policy if exists "super_panel_shares_delete" on public.super_panel_shares;
create policy "super_panel_shares_delete" on public.super_panel_shares
  for delete using (
    shared_by = auth.uid()
    or shared_with_id = auth.uid()
    or lower(shared_with_email) = lower(coalesce(auth.jwt()->>'email', ''))
  );

-- 8. Actualizar super_upsert_credential para permitir credenciales en paneles compartidos aceptados
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
    -- El panel debe ser del propio usuario o estar compartido y aceptado
    if not exists (
      select 1 from public.super_panels where id = p_panel_id and owner_id = auth.uid()
      union
      select 1 from public.super_panel_shares
      where panel_id = p_panel_id
        and (shared_with_id = auth.uid() or lower(shared_with_email) = lower(coalesce(auth.jwt()->>'email', '')))
        and status = 'accepted'
    ) then
      raise exception 'Panel no encontrado o sin acceso';
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
    where id = p_id and (
      owner_id = auth.uid()
      or exists (
        select 1 from public.super_panels where id = super_panel_credentials.panel_id and owner_id = auth.uid()
      )
    );
    if not found then
      raise exception 'Credencial no encontrada o ajena';
    end if;
    v_id := p_id;
  end if;

  return v_id;
end;
$$;

-- 9. Actualizar super_reveal_credential para que usuarios con panel compartido puedan descifrar para login
create or replace function public.super_reveal_credential(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  select owner_id, panel_id, superpaneles.dec(password_enc) as pw
  into v_rec
  from public.super_panel_credentials where id = p_id;

  if v_rec is null then
    return null;
  end if;

  if v_rec.owner_id <> auth.uid()
     and current_setting('request.jwt.claims', true)::json->>'role' <> 'service_role'
     and not exists (
       select 1 from public.super_panel_shares
       where panel_id = v_rec.panel_id
         and (shared_with_id = auth.uid() or lower(shared_with_email) = lower(coalesce(auth.jwt()->>'email', '')))
         and status = 'accepted'
     ) then
    raise exception 'Sin acceso a esta credencial';
  end if;

  return v_rec.pw;
end;
$$;

-- 10. RLS en super_panel_credentials para ver credenciales accesibles
drop policy if exists "super_panel_credentials_owner_all" on public.super_panel_credentials;
drop policy if exists "super_panel_credentials_select" on public.super_panel_credentials;
drop policy if exists "super_panel_credentials_all" on public.super_panel_credentials;

create policy "super_panel_credentials_select" on public.super_panel_credentials
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.super_panel_shares s
      where s.panel_id = public.super_panel_credentials.panel_id
        and (s.shared_with_id = auth.uid() or lower(s.shared_with_email) = lower(coalesce(auth.jwt()->>'email', '')))
        and s.status = 'accepted'
    )
  );

create policy "super_panel_credentials_insert" on public.super_panel_credentials
  for insert with check (
    owner_id = auth.uid()
  );

create policy "super_panel_credentials_update" on public.super_panel_credentials
  for update using (
    owner_id = auth.uid()
  );

create policy "super_panel_credentials_delete" on public.super_panel_credentials
  for delete using (
    owner_id = auth.uid()
  );
