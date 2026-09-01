import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { AdminSubscriptionRow, MySubscription, Plan, SubscriptionStatus } from './types'

/** Suscripción efectiva del usuario actual (null si la BD aún no está migrada). */
export async function fetchMySubscription(): Promise<MySubscription | null> {
  try {
    const { data, error } = await supabase.rpc('super_my_subscription')
    if (error) throw error
    return (data as MySubscription | null) ?? null
  } catch {
    return null
  }
}

export function useMySubscription() {
  return useQuery({
    queryKey: ['my-subscription'],
    queryFn: fetchMySubscription,
    staleTime: 30_000,
  })
}

/** Catálogo de planes (visibles para mostrar precios/límites en «Mi plan»). */
export async function fetchPlans(): Promise<Plan[]> {
  try {
    const { data, error } = await supabase
      .from('super_plans')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []) as Plan[]
  } catch {
    return []
  }
}

export function usePlans() {
  return useQuery({ queryKey: ['plans'], queryFn: fetchPlans, staleTime: 60_000 })
}

export async function adminListSubscriptions(): Promise<AdminSubscriptionRow[]> {
  try {
    const { data, error } = await supabase.rpc('super_admin_list_subscriptions')
    if (error) throw error
    return (data ?? []) as AdminSubscriptionRow[]
  } catch {
    return []
  }
}

/** Asigna (o con plan_id null, elimina) la suscripción de un usuario. */
export async function adminSetSubscription(input: {
  userId: string
  planId: string | null
  status?: SubscriptionStatus
  periodEnd?: string | null // ISO
  notes?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('super_admin_set_subscription', {
    p_user_id: input.userId,
    p_plan_id: input.planId,
    p_status: input.status ?? 'active',
    p_period_end: input.periodEnd ?? null,
    p_notes: input.notes ?? null,
  })
  if (error) throw error
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
  expired: 'Caducada',
}

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
]
