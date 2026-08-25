import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Panel, TabItem } from './types'

interface TabsContextType {
  tabs: TabItem[]
  activeTabId: string
  openPanelTab: (panel: Panel) => void
  openTab: (tab: TabItem) => void
  closeTab: (tabId: string) => void
  switchTab: (tabId: string) => void
  closeAllTabs: () => void
}

const STORAGE_KEY = 'superpaneles_open_tabs'

const defaultTabs: TabItem[] = [
  {
    id: 'dashboard',
    title: 'Categorías',
    path: '/',
    closable: false,
  },
]

const TabsContext = createContext<TabsContextType>({
  tabs: defaultTabs,
  activeTabId: 'dashboard',
  openPanelTab: () => {},
  openTab: () => {},
  closeTab: () => {},
  switchTab: () => {},
  closeAllTabs: () => {},
})

export function TabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [tabs, setTabs] = useState<TabItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as TabItem[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Asegurar que dashboard siempre exista
          if (!parsed.some((t) => t.id === 'dashboard')) {
            return [...defaultTabs, ...parsed]
          }
          return parsed
        }
      }
    } catch {
      /* ignore */
    }
    return defaultTabs
  })

  const [activeTabId, setActiveTabId] = useState<string>('dashboard')

  // Guardar en localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
    } catch {
      /* ignore */
    }
  }, [tabs])

  // Sincronizar activeTabId con la ruta actual
  useEffect(() => {
    const pathname = location.pathname
    if (pathname === '/' || pathname === '') {
      setActiveTabId('dashboard')
    } else if (pathname.startsWith('/panels/')) {
      const panelId = pathname.replace('/panels/', '')
      const tabId = `panel-${panelId}`
      const existing = tabs.find((t) => t.id === tabId)
      if (existing) {
        setActiveTabId(tabId)
      } else {
        // Añadir pestaña si se accedió por URL directa
        const newTab: TabItem = {
          id: tabId,
          title: `Panel (${panelId.slice(0, 6)}…)`,
          path: pathname,
          panelId,
          closable: true,
        }
        setTabs((prev) => [...prev, newTab])
        setActiveTabId(tabId)
      }
    } else if (pathname === '/vault') {
      const tabId = 'vault'
      if (!tabs.some((t) => t.id === tabId)) {
        setTabs((prev) => [...prev, { id: tabId, title: 'Contraseñas', path: '/vault', closable: true }])
      }
      setActiveTabId(tabId)
    } else if (pathname === '/admin/users') {
      const tabId = 'admin-users'
      if (!tabs.some((t) => t.id === tabId)) {
        setTabs((prev) => [...prev, { id: tabId, title: 'Usuarios', path: '/admin/users', closable: true }])
      }
      setActiveTabId(tabId)
    }
  }, [location.pathname])

  function openPanelTab(panel: Panel) {
    const tabId = `panel-${panel.id}`
    const path = `/panels/${panel.id}`

    setTabs((prev) => {
      const existingIdx = prev.findIndex((t) => t.id === tabId)
      if (existingIdx !== -1) {
        // Actualizar título por si cambió
        const updated = [...prev]
        updated[existingIdx] = {
          ...updated[existingIdx],
          title: panel.name,
          kind: panel.kind,
          logo_url: panel.logo_url,
          category: panel.category,
        }
        return updated
      }
      return [
        ...prev,
        {
          id: tabId,
          title: panel.name,
          path,
          panelId: panel.id,
          kind: panel.kind,
          logo_url: panel.logo_url,
          category: panel.category,
          closable: true,
        },
      ]
    })
    setActiveTabId(tabId)
    navigate(path)
  }

  function openTab(tab: TabItem) {
    setTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) return prev
      return [...prev, tab]
    })
    setActiveTabId(tab.id)
    navigate(tab.path)
  }

  function switchTab(tabId: string) {
    const target = tabs.find((t) => t.id === tabId)
    if (target) {
      setActiveTabId(tabId)
      navigate(target.path)
    }
  }

  function closeTab(tabId: string) {
    const targetIdx = tabs.findIndex((t) => t.id === tabId)
    if (targetIdx === -1) return

    const remaining = tabs.filter((t) => t.id !== tabId)
    setTabs(remaining)

    if (activeTabId === tabId) {
      // Activar la pestaña previa o el dashboard
      const nextTab = remaining[Math.max(0, targetIdx - 1)] ?? remaining[0] ?? defaultTabs[0]
      setActiveTabId(nextTab.id)
      navigate(nextTab.path)
    }
  }

  function closeAllTabs() {
    setTabs(defaultTabs)
    setActiveTabId('dashboard')
    navigate('/')
  }

  return (
    <TabsContext.Provider
      value={{
        tabs,
        activeTabId,
        openPanelTab,
        openTab,
        closeTab,
        switchTab,
        closeAllTabs,
      }}
    >
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs(): TabsContextType {
  return useContext(TabsContext)
}

