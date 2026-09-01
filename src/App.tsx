import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { TabsProvider } from './lib/tabs'
import { ThemeProvider, applyStoredThemeEarly } from './lib/theme'
import Layout from './components/Layout'
import InstallPrompt from './components/InstallPrompt'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import PanelFrame from './pages/PanelFrame'
import Vault from './pages/Vault'
import AdminUsers from './pages/AdminUsers'
import AdminBranding from './pages/AdminBranding'

// Aplica tema/acentos guardados antes del primer render (evita destello)
applyStoredThemeEarly()

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function RequireAuth() {
  const { loading, session } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center text-slate-500">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireSuperadmin({ children }: { children: ReactNode }) {
  const { loading, isSuperadmin } = useAuth()
  if (loading) return null
  if (!isSuperadmin) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <HashRouter>
            <TabsProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<RequireAuth />}>
                  <Route element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="panels/:id" element={<PanelFrame />} />
                    <Route path="vault" element={<Vault />} />
                    <Route
                      path="admin/users"
                      element={
                        <RequireSuperadmin>
                          <AdminUsers />
                        </RequireSuperadmin>
                      }
                    />
                    <Route
                      path="admin/branding"
                      element={
                        <RequireSuperadmin>
                          <AdminBranding />
                        </RequireSuperadmin>
                      }
                    />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              {/* Banner de instalación PWA (Android/iOS) */}
              <InstallPrompt />
            </TabsProvider>
          </HashRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
