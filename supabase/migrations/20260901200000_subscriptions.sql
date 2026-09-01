-- ============================================================================
-- SuperPanel · Planes y suscripciones (comercialización manual)
--
-- Modelo SIN pasarela de pago: los planes se crean manualmente en
-- public.super_plans y el superadmin asigna una suscripción a cada usuario
-- (página Usuarios). Sin suscripción asignada = acceso sin restricciones
-- (compatibilidad con los usuarios existentes).
--
-- Límites que aplica la BASE DE DATOS (no solo el frontend):
--   max_panels      → máximo de paneles propios (null = ilimitado)
--   max_shares      → máximo de comparticiones activas (null = ilimitado)
--   can_share       → permite compartir paneles / invitar colaboradores
--   can_use_vault   → permite guardar credenciales en la bóveda
-- Suscripción vencida (status o current_period_end) → modo SOLO LECTURA.
-- Los superadmins y los procesos service_role nunca tienen límites.
--
-- Los nuevos registros públicos reciben automáticamente el plan marcado
-- como is_default con sus trial_days de prueba (si existe).
-- ============================================================================

-- 1. Catálogo de planes (filas creadas manualmente) ---------------------------

create table if not exists public.super_plans (
  id            text primary key,                -- p.ej. 'free', 'starter', 'pro'
  name          text not null,
  description   text,
  price_label   text,                            -- solo display, p.ej. '9 €/mes'
  trial_days    int not null default 0 check (trial_days >= 0),
  max_panels    int check (max_panels is null or max_panels >= 0),
  max_shares    int check (max_shares is null or max_shares >= 0),
  can_share     boolean not null default true,
  can_use_vault boolean not null default true,
  active        boolean not null default true,
  is_public     boolean not null default true,   -- visible en la página «Mi plan»
  is_default    boolean not null default false,  -- plan/trial de los nuevos registros
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists super_plans_one_default
  on public.super_plans (is_default) where is_default;

alter table public.super_plans enable row level security;

drop policy if exists "super_plans_select" on public.super_plans;
create policy "super_plans_select" on public.super_plans
  for select using (true);

-- Helper: ¿el usuario actual es superadmin? (security definer para poder usarse
-- desde políticas RLS y otras funciones definer)
create or replace function public.super_is_superadmin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.super_profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$;

-- 2. Suscripción por usuario (1:1, asignada por el superadmin) ----------------

create table if not exists public.super_subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan_id            text not null references public.super_plans(id) on delete restrict,
  status             text not null default 'active'
                       check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_end timestamptz,                -- null = sin vencimiento
  notes              text,                       -- notas del admin (p.ej. 'pagó por transferencia')
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_super_subscriptions_plan on public.super_subscriptions (plan_id);

alter table public.super_subscriptions enable row level security;

drop policy if exists "super_subscriptions_select" on public.super_subscriptions;
create policy "super_subscriptions_select" on public.super_subscriptions
  for select using (user_id = auth.uid() or public.super_is_superadmin());

-- 3. Helpers ------------------------------------------------------------------

-- Estado efectivo de un usuario respecto a su plan:
--   has_subscription=false → sin límites (superadmin o sin suscripción asignada)
--   writable=false         → suscripción vencida/impagada: modo solo lectura
create or replace function public.super_subscription_state(p_user_id uuid)
returns table (
  has_subscription boolean,
  writable         boolean,
  plan_id          text,
  plan_name        text,
  max_panels       int,
  max_shares       int,
  can_share        boolean,
  can_use_vault    boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role  text;
  v_sub   record;
  v_plan  record;
  v_valid boolean;
begin
  select role into v_role from public.super_profiles where id = p_user_id;
  if v_role = 'superadmin' then
    return query select false, true, null::text, null::text, null::int, null::int, true, true;
    return;
  end if;

  select * into v_sub from public.super_subscriptions where user_id = p_user_id;
  if not found then
    -- Sin suscripción asignada: acceso completo (modelo manual / usuarios legacy)
    return query select false, true, null::text, null::text, null::int, null::int, true, true;
    return;
  end if;

  v_valid := v_sub.status in ('trialing', 'active')
    and (v_sub.current_period_end is null or now() < v_sub.current_period_end);

  select * into v_plan from public.super_plans where id = v_sub.plan_id;
  if not found then
    -- Plan eliminado (no debería pasar: FK restrict): desbloquear por seguridad
    return query select false, true, null::text, null::text, null::int, null::int, true, true;
    return;
  end if;

  return query select
    true,
    v_valid,
    v_plan.id,
    v_plan.name,
    v_plan.max_panels,
    v_plan.max_shares,
    v_plan.can_share,
    v_plan.can_use_vault;
end;
$$;

-- 4. Gating: triggers de límites y solo lectura --------------------------------

-- 4a. Paneles propios: límite de cantidad + solo lectura al vencer
create or replace function public.super_enforce_plan_panels()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_writable boolean;
  v_max int;
  v_count int;
begin
  if v_uid is null then return coalesce(new, old); end if; -- service_role / cascadas admin

  select s.writable, s.max_panels into v_writable, v_max
  from public.super_subscription_state(v_uid) s;

  if tg_op <> 'INSERT' and not v_writable then
    raise exception 'Tu suscripción está caducada: modo solo lectura. Renueva tu plan para volver a editar.';
  end if;

  if tg_op = 'INSERT' and v_max is not null then
    select count(*) into v_count from public.super_panels where owner_id = v_uid;
    if v_count >= v_max then
      raise exception 'Límite de tu plan alcanzado (% paneles). Amplía tu plan para añadir más.', v_max;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists super_trg_plan_panels on public.super_panels;
create trigger super_trg_plan_panels
  before insert or update or delete on public.super_panels
  for each row execute function public.super_enforce_plan_panels();

-- 4b. Credenciales (bóveda): requiere can_use_vault + solo lectura al vencer
create or replace function public.super_enforce_plan_credentials()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_writable boolean;
  v_vault boolean;
begin
  if v_uid is null then return coalesce(new, old); end if;

  select s.writable, s.can_use_vault into v_writable, v_vault
  from public.super_subscription_state(v_uid) s;

  if not v_writable then
    raise exception 'Tu suscripción está caducada: modo solo lectura. Renueva tu plan para volver a editar.';
  end if;

  if tg_op = 'INSERT' and not v_vault then
    raise exception 'Tu plan no incluye la bóveda de credenciales. Amplía tu plan para usarla.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists super_trg_plan_credentials on public.super_panel_credentials;
create trigger super_trg_plan_credentials
  before insert or update or delete on public.super_panel_credentials
  for each row execute function public.super_enforce_plan_credentials();

-- 4c. Comparticiones: el PROPIETARIO (shared_by) queda sujeto a su plan;
--     el receptor siempre puede aceptar/rechazar o dejar de acceder.
create or replace function public.super_enforce_plan_shares()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_writable boolean;
  v_can_share boolean;
  v_max int;
  v_count int;
begin
  if v_uid is null then return coalesce(new, old); end if;

  select s.writable, s.can_share, s.max_shares into v_writable, v_can_share, v_max
  from public.super_subscription_state(v_uid) s;

  if tg_op = 'INSERT' then
    if not v_writable then
      raise exception 'Tu suscripción está caducada: modo solo lectura.';
    end if;
    if not v_can_share then
      raise exception 'Tu plan no permite compartir paneles. Amplía tu plan para usarlo.';
    end if;
    if v_max is not null then
      select count(*) into v_count
      from public.super_panel_shares
      where shared_by = new.shared_by and status in ('pending', 'accepted');
      if v_count >= v_max then
        raise exception 'Límite de tu plan alcanzado (% comparticiones activas). Amplía tu plan.', v_max;
      end if;
    end if;
  elsif old.shared_by = v_uid and not v_writable then
    raise exception 'Tu suscripción está caducada: modo solo lectura.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists super_trg_plan_shares on public.super_panel_shares;
create trigger super_trg_plan_shares
  before insert or update or delete on public.super_panel_shares
  for each row execute function public.super_enforce_plan_shares();

-- 4d. Invitaciones de colaboración: el remitente (sender_id) queda sujeto a su plan
create or replace function public.super_enforce_plan_collaborations()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_writable boolean;
  v_can_share boolean;
begin
  if v_uid is null then return coalesce(new, old); end if;

  select s.writable, s.can_share into v_writable, v_can_share
  from public.super_subscription_state(v_uid) s;

  if tg_op = 'INSERT' then
    if not v_writable then
      raise exception 'Tu suscripción está caducada: modo solo lectura.';
    end if;
    if not v_can_share then
      raise exception 'Tu plan no permite invitar colaboradores. Amplía tu plan para usarlo.';
    end if;
  elsif old.sender_id = v_uid and not v_writable then
    raise exception 'Tu suscripción está caducada: modo solo lectura.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists super_trg_plan_collabs on public.super_collaborations;
create trigger super_trg_plan_collabs
  before insert or update or delete on public.super_collaborations
  for each row execute function public.super_enforce_plan_collaborations();

-- 5. RPC: mi suscripción (para el frontend) ------------------------------------

create or replace function public.super_my_subscription()
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_state record;
  v_sub record;
  v_panels int;
  v_shares int;
begin
  if v_uid is null then return null; end if;

  select * into v_state from public.super_subscription_state(v_uid);

  select count(*) into v_panels from public.super_panels where owner_id = v_uid;
  select count(*) into v_shares from public.super_panel_shares
    where shared_by = v_uid and status in ('pending', 'accepted');

  select status, current_period_end into v_sub
    from public.super_subscriptions where user_id = v_uid;

  return json_build_object(
    'has_subscription', v_state.has_subscription,
    'read_only', not v_state.writable,
    'status', v_sub.status,
    'current_period_end', v_sub.current_period_end,
    'plan', case when v_state.has_subscription then json_build_object(
        'id', v_state.plan_id,
        'name', v_state.plan_name,
        'max_panels', v_state.max_panels,
        'max_shares', v_state.max_shares,
        'can_share', v_state.can_share,
        'can_use_vault', v_state.can_use_vault
      ) else null end,
    'usage', json_build_object(
      'panels_used', v_panels,
      'shares_used', v_shares
    )
  );
end;
$$;

-- 6. RPC de administración (solo superadmins) ----------------------------------

create or replace function public.super_admin_list_subscriptions()
returns table (
  user_id            uuid,
  email              text,
  full_name          text,
  plan_id            text,
  plan_name          text,
  status             text,
  current_period_end timestamptz,
  notes              text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.super_is_superadmin() then
    raise exception 'Solo superadmins';
  end if;

  return query
    select s.user_id, p.email, p.full_name, s.plan_id, pl.name,
           s.status, s.current_period_end, s.notes
    from public.super_subscriptions s
    join public.super_profiles p on p.id = s.user_id
    left join public.super_plans pl on pl.id = s.plan_id
    order by p.email asc;
end;
$$;

create or replace function public.super_admin_set_subscription(
  p_user_id   uuid,
  p_plan_id   text,          -- null = quitar la suscripción (acceso sin límites)
  p_status    text default 'active',
  p_period_end timestamptz default null,
  p_notes     text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.super_is_superadmin() then
    raise exception 'Solo superadmins';
  end if;

  if p_plan_id is null then
    delete from public.super_subscriptions where user_id = p_user_id;
    return;
  end if;

  if not exists (select 1 from public.super_plans where id = p_plan_id) then
    raise exception 'El plan «%» no existe. Créalo primero en la tabla super_plans.', p_plan_id;
  end if;

  insert into public.super_subscriptions (user_id, plan_id, status, current_period_end, notes)
  values (p_user_id, p_plan_id, p_status, p_period_end, p_notes)
  on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        notes = excluded.notes,
        updated_at = now();
end;
$$;

-- 7. Nuevos registros: suscripción automática al plan por defecto (trial) ------

create or replace function public.super_handle_new_user_subscription()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_plan record;
begin
  if new.role = 'superadmin' then return new; end if;

  select * into v_plan
  from public.super_plans
  where is_default and active
  order by sort_order asc
  limit 1;

  if v_plan.id is null then return new; end if;

  insert into public.super_subscriptions (user_id, plan_id, status, current_period_end)
  values (
    new.id,
    v_plan.id,
    case when coalesce(v_plan.trial_days, 0) > 0 then 'trialing' else 'active' end,
    case when coalesce(v_plan.trial_days, 0) > 0
      then now() + make_interval(days => v_plan.trial_days)
      else null
    end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists super_trg_new_user_subscription on public.super_profiles;
create trigger super_trg_new_user_subscription
  after insert on public.super_profiles
  for each row execute function public.super_handle_new_user_subscription();

-- 8. Permisos ------------------------------------------------------------------

grant select on public.super_plans to anon, authenticated;
grant select on public.super_subscriptions to authenticated;
grant execute on function public.super_my_subscription() to authenticated;
grant execute on function public.super_admin_list_subscriptions() to authenticated;
grant execute on function public.super_admin_set_subscription(uuid, text, text, timestamptz, text) to authenticated;

-- Funciones internas (solo se ejecutan vía triggers y RPCs definer de postgres)
revoke execute on function public.super_subscription_state(uuid) from public, anon, authenticated;
revoke execute on function public.super_enforce_plan_panels() from public, anon, authenticated;
revoke execute on function public.super_enforce_plan_credentials() from public, anon, authenticated;
revoke execute on function public.super_enforce_plan_shares() from public, anon, authenticated;
revoke execute on function public.super_enforce_plan_collaborations() from public, anon, authenticated;
revoke execute on function public.super_handle_new_user_subscription() from public, anon, authenticated;

-- ============================================================================
-- EJEMPLO de planes (crearlos manualmente cuando se decidan precios/límites).
-- Descomentar y ajustar en el SQL Editor de Supabase:
--
-- insert into public.super_plans
--   (id, name, description, price_label, trial_days, max_panels, max_shares,
--    can_share, can_use_vault, is_default, sort_order)
-- values
--   ('free',    'Free',    'Para probar la plataforma',       'Gratis',   0, 3,   0,    false, false, true,  1),
--   ('starter', 'Starter', '25 paneles y bóveda completa',    '9 €/mes', 14, 25,  20,   true,  true,  false, 2),
--   ('pro',     'Pro',     'Paneles y comparticiones sin límite', '24 €/mes', 14, null, null, true, true, false, 3);
-- ============================================================================
