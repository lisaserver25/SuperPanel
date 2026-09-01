-- ============================================================================
-- SuperPanel · Modo de credenciales en comparticiones + tipo de login embebido
--
-- 1. super_panel_shares.credential_mode:
--    'common'  → acceso COMÚN: el invitado usa las credenciales del PROPIETARIO
--                (las mismas para todos los invitados del panel)
--    'private' → acceso PRIVADO: cada invitado solo ve las SUYAS
--
-- 2. super_panels.login_type: estrategia de auto-login embebido
--    null|'none' → manual (solo copiar credenciales)
--    'xui'       → X-UI / 3x-ui vía panel-proxy (sesión por cookie firmada)
-- ============================================================================

-- 1. Modo de credenciales por compartición ('common' por defecto: las
--    comparticiones existentes pasan a acceso común)
alter table public.super_panel_shares
  add column if not exists credential_mode text not null default 'common';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'super_panel_shares_credmode_check'
  ) then
    alter table public.super_panel_shares
      add constraint super_panel_shares_credmode_check
      check (credential_mode in ('common', 'private'));
  end if;
end $$;

-- Todas las comparticiones de paneles Plex (subservicio o categoría) en acceso común
update public.super_panel_shares s
set credential_mode = 'common'
from public.super_panels p
where p.id = s.panel_id
  and (
    lower(coalesce(p.subcategory, '')) like '%plex%'
    or lower(coalesce(p.category, '')) = 'plex'
  );

-- 2. Tipo de login embebido del panel
alter table public.super_panels
  add column if not exists login_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'super_panels_logintype_check'
  ) then
    alter table public.super_panels
      add constraint super_panels_logintype_check
      check (login_type is null or login_type in ('none', 'xui'));
  end if;
end $$;

-- 3. RLS de credenciales: las propias SIEMPRE; las del PROPIETARIO del panel
--    solo si existe una compartición aceptada en modo 'common'.
--    (Antes cualquier invitado veía TODAS las credenciales del panel,
--     incluidas las privadas de otros invitados: se cierra aquí.)
drop policy if exists "super_panel_credentials_select" on public.super_panel_credentials;
create policy "super_panel_credentials_select" on public.super_panel_credentials
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.super_panel_shares s
      join public.super_panels p on p.id = s.panel_id
      where s.panel_id = public.super_panel_credentials.panel_id
        and public.super_panel_credentials.owner_id = p.owner_id
        and s.status = 'accepted'
        and s.credential_mode = 'common'
        and (
          s.shared_with_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt()->>'email', ''))
        )
    )
  );

-- 4. RPC de descifrado con la misma regla (propias, service_role o común)
create or replace function public.super_reveal_credential(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_rec record;
  v_allowed boolean;
begin
  select owner_id, panel_id, superpaneles.dec(password_enc) as pw
  into v_rec
  from public.super_panel_credentials where id = p_id;

  if v_rec is null then
    return null;
  end if;

  v_allowed :=
    v_rec.owner_id = auth.uid()
    or current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    or exists (
      select 1
      from public.super_panel_shares s
      join public.super_panels p on p.id = s.panel_id
      where s.panel_id = v_rec.panel_id
        and p.owner_id = v_rec.owner_id
        and s.status = 'accepted'
        and s.credential_mode = 'common'
        and (
          s.shared_with_id = auth.uid()
          or lower(s.shared_with_email) = lower(coalesce(auth.jwt()->>'email', ''))
        )
    );

  if not v_allowed then
    raise exception 'Sin acceso a esta credencial';
  end if;

  return v_rec.pw;
end;
$$;

-- 5. Permisos intactos (mismos grants que la versión previa)
grant execute on function public.super_reveal_credential(uuid) to authenticated, service_role;
