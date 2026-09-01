import { useAuth } from '../lib/auth'
import { useMySubscription, usePlans, SUBSCRIPTION_STATUS_LABELS } from '../lib/billing'
import { Badge, EmptyState } from '../components/ui'
import { Check, Gem, KeyRound, Share2, TriangleAlert, X } from 'lucide-react'
import type { SubscriptionStatus } from '../lib/types'

function statusTone(status: SubscriptionStatus | null): 'green' | 'sky' | 'slate' | 'red' {
  switch (status) {
    case 'active':
      return 'green'
    case 'trialing':
      return 'sky'
    case 'past_due':
      return 'slate'
    default:
      return 'red'
  }
}

function limitText(max: number | null): string {
  return max == null ? 'Ilimitados' : String(max)
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max == null ? 0 : Math.min(100, Math.round((used / max) * 100))
  const over = max != null && used >= max
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={over ? 'font-semibold text-red-300' : 'font-mono text-slate-300'}>
          {used} / {limitText(max)}
        </span>
      </div>
      {max != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={over ? 'h-full rounded-full bg-red-500' : 'h-full rounded-full bg-sky-500'}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default function Subscription() {
  const { profile } = useAuth()
  const subQuery = useMySubscription()
  const plansQuery = usePlans()

  const sub = subQuery.data
  const plans = (plansQuery.data ?? []).filter((p) => p.active && p.is_public)

  const loading = subQuery.isLoading
  const readOnly = sub?.read_only === true
  const isSuperadmin = profile?.role === 'superadmin'

  const daysLeft = (() => {
    if (!sub?.current_period_end) return null
    const ms = new Date(sub.current_period_end).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / 86_400_000))
  })()

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">Mi plan</h1>
          <p className="hidden sm:block text-sm text-slate-400">
            Estado de tu suscripción, límites y planes disponibles
          </p>
        </div>
      </div>

      {readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-950/30 p-3.5 text-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <TriangleAlert className="shrink-0 text-red-400" size={18} />
            <div className="min-w-0">
              <p className="font-semibold text-red-100">Suscripción caducada: modo solo lectura</p>
              <p className="text-xs text-red-200/70">
                Puedes consultar tus paneles, pero no añadir ni editar. Renueva tu plan para recuperar el acceso completo.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <EmptyState>Cargando tu suscripción…</EmptyState>
      ) : !sub ? (
        <EmptyState>
          No se pudo cargar la suscripción. Si acabas de aplicar la migración, recarga la página.
        </EmptyState>
      ) : (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
                <Gem size={20} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">
                  {isSuperadmin
                    ? 'Acceso de administrador'
                    : sub.plan
                      ? sub.plan.name
                      : 'Sin plan asignado'}
                </p>
                <p className="text-xs text-slate-400">
                  {isSuperadmin
                    ? 'Los superadmins no tienen límites'
                    : sub.has_subscription
                      ? sub.status && (
                          <Badge tone={statusTone(sub.status)}>
                            {SUBSCRIPTION_STATUS_LABELS[sub.status]}
                          </Badge>
                        )
                      : 'Acceso sin restricciones'}
                </p>
              </div>
            </div>
            {sub.current_period_end && (
              <div className="text-right text-xs text-slate-400">
                {sub.status === 'trialing' ? 'Prueba finaliza' : 'Renueva'} el{' '}
                {new Date(sub.current_period_end).toLocaleDateString('es')}
                {sub.status === 'trialing' && daysLeft != null && (
                  <span className="block text-sky-300">{daysLeft} día{daysLeft === 1 ? '' : 's'} restante{daysLeft === 1 ? '' : 's'}</span>
                )}
              </div>
            )}
          </div>

          {sub.plan && (
            <>
              <div className="grid gap-4 border-t border-slate-800 pt-4 sm:grid-cols-2">
                <UsageBar label="Paneles propios" used={sub.usage.panels_used} max={sub.plan.max_panels} />
                <UsageBar label="Comparticiones activas" used={sub.usage.shares_used} max={sub.plan.max_shares} />
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                <Badge tone={sub.plan.can_use_vault ? 'green' : 'slate'}>
                  <KeyRound size={11} /> Bóveda de credenciales: {sub.plan.can_use_vault ? 'incluida' : 'no incluida'}
                </Badge>
                <Badge tone={sub.plan.can_share ? 'green' : 'slate'}>
                  <Share2 size={11} /> Compartir paneles: {sub.plan.can_share ? 'incluido' : 'no incluido'}
                </Badge>
              </div>
            </>
          )}
        </div>
      )}

      {/* Catálogo de planes disponibles */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Planes disponibles</h2>
        {plans.length === 0 ? (
          <EmptyState>Todavía no hay planes definidos.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const current = sub?.plan?.id === p.id
              return (
                <div
                  key={p.id}
                  className={
                    current
                      ? 'card space-y-2 border-sky-500/60 p-4 shadow-md shadow-sky-950/30'
                      : 'card space-y-2 p-4'
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-100">{p.name}</p>
                    {current && (
                      <Badge tone="sky">
                        <Check size={11} /> Tu plan
                      </Badge>
                    )}
                  </div>
                  {p.price_label && <p className="text-lg font-bold text-sky-300">{p.price_label}</p>}
                  {p.description && <p className="text-xs text-slate-400">{p.description}</p>}
                  <ul className="space-y-1 pt-1 text-xs text-slate-300">
                    <li className="flex items-center gap-1.5">
                      {p.max_panels == null ? <Check size={12} className="text-emerald-400" /> : <Check size={12} className="text-slate-500" />}
                      {limitText(p.max_panels)} paneles
                    </li>
                    <li className="flex items-center gap-1.5">
                      {p.can_use_vault ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <X size={12} className="text-red-400" />
                      )}
                      Bóveda de credenciales
                    </li>
                    <li className="flex items-center gap-1.5">
                      {p.can_share ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <X size={12} className="text-red-400" />
                      )}
                      Compartir paneles
                    </li>
                    {p.trial_days > 0 && (
                      <li className="flex items-center gap-1.5 text-sky-300">
                        <Check size={12} /> {p.trial_days} días de prueba
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
        {!isSuperadmin && (
          <p className="pt-1 text-xs text-slate-500">
            Para contratar, cambiar o renovar tu plan, contacta con el administrador de tu SuperPanel.
          </p>
        )}
      </div>
    </div>
  )
}
