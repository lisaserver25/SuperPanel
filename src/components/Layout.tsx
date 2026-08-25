import clsx from 'clsx'
import { KeyRound, LayoutGrid, LogOut, Users } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function Layout() {
  const { user, isSuperadmin } = useAuth()
  const navigate = useNavigate()

  const links: { to: string; label: string; icon: typeof LayoutGrid; end?: boolean }[] = [
    { to: '/', label: 'Mis paneles', icon: LayoutGrid, end: true },
    { to: '/vault', label: 'Bóveda', icon: KeyRound },
  ]
  if (isSuperadmin) links.push({ to: '/admin/users', label: 'Usuarios', icon: Users })

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded bg-sky-500/20 text-sm text-sky-300">S</span>
            SuperPaneles
          </NavLink>
          <nav className="flex items-center gap-1">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  )
                }
              >
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
            <span className="hidden max-w-[220px] truncate sm:block">{user?.email}</span>
            <button
              className="btn-ghost"
              onClick={async () => {
                await supabase.auth.signOut()
                navigate('/login')
              }}
            >
              <LogOut size={16} /> Salir
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
