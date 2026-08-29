// Gestor de categorías personalizadas por usuario con persistencia local y sincronización

const FALLBACK_KEY = 'sp_custom_cats_global'

export function getUserCustomCategories(userId?: string): string[] {
  const keys = [
    userId ? `sp_custom_cats_${userId}` : null,
    FALLBACK_KEY,
  ].filter((k): k is string => !!k)

  const set = new Set<string>()
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            if (typeof c === 'string' && c.trim()) set.add(c.trim())
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function saveUserCustomCategory(userId: string | undefined, category: string): string[] {
  const trimmed = category.trim()
  if (!trimmed) return getUserCustomCategories(userId)
  const current = getUserCustomCategories(userId)
  const exists = current.some((c) => c.toLowerCase() === trimmed.toLowerCase())
  const updated = exists ? current : [...current, trimmed]

  try {
    if (userId) {
      localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
    }
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

export function renameUserCustomCategory(userId: string | undefined, oldName: string, newName: string): string[] {
  const trimmedOld = oldName.trim().toLowerCase()
  const trimmedNew = newName.trim()
  if (!trimmedNew) return getUserCustomCategories(userId)
  const current = getUserCustomCategories(userId)
  const updated = current.map((c) => (c.toLowerCase() === trimmedOld ? trimmedNew : c))
  if (!updated.some((c) => c.toLowerCase() === trimmedNew.toLowerCase())) {
    updated.push(trimmedNew)
  }

  try {
    if (userId) {
      localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
    }
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

export function removeUserCustomCategory(userId: string | undefined, category: string): string[] {
  const trimmed = category.trim().toLowerCase()
  const current = getUserCustomCategories(userId)
  const updated = current.filter((c) => c.toLowerCase() !== trimmed)

  try {
    if (userId) {
      localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
    }
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

// --- Mapeo de categoría por panel (para persistencia robusta e inmediata) ---

const PANEL_CAT_FALLBACK_KEY = 'sp_panel_cats_global'

export function getUserPanelCategoryMap(userId?: string): Record<string, string> {
  const keys = [
    userId ? `sp_panel_cats_${userId}` : null,
    PANEL_CAT_FALLBACK_KEY,
  ].filter((k): k is string => !!k)

  const map: Record<string, string> = {}
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed && typeof parsed === 'object') {
          for (const [panelId, cat] of Object.entries(parsed)) {
            if (typeof cat === 'string' && cat.trim() && !map[panelId]) {
              map[panelId] = cat.trim()
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return map
}

export function saveUserPanelCategory(userId: string | undefined, panelId: string, category: string): void {
  const trimmed = category.trim()
  if (!panelId) return
  const current = getUserPanelCategoryMap(userId)
  current[panelId] = trimmed || 'General'

  try {
    if (userId) {
      localStorage.setItem(`sp_panel_cats_${userId}`, JSON.stringify(current))
    }
    localStorage.setItem(PANEL_CAT_FALLBACK_KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
}

export function renameUserPanelCategory(userId: string | undefined, oldName: string, newName: string): void {
  const trimmedOld = oldName.trim().toLowerCase()
  const trimmedNew = newName.trim()
  if (!trimmedNew) return
  const current = getUserPanelCategoryMap(userId)
  let changed = false
  for (const [panelId, cat] of Object.entries(current)) {
    if (cat.trim().toLowerCase() === trimmedOld) {
      current[panelId] = trimmedNew
      changed = true
    }
  }

  if (changed) {
    try {
      if (userId) {
        localStorage.setItem(`sp_panel_cats_${userId}`, JSON.stringify(current))
      }
      localStorage.setItem(PANEL_CAT_FALLBACK_KEY, JSON.stringify(current))
    } catch {
      /* ignore */
    }
  }
}

export function removeUserPanelCategory(userId: string | undefined, panelId: string): void {
  if (!panelId) return
  const current = getUserPanelCategoryMap(userId)
  if (current[panelId]) {
    delete current[panelId]
    try {
      if (userId) {
        localStorage.setItem(`sp_panel_cats_${userId}`, JSON.stringify(current))
      }
      localStorage.setItem(PANEL_CAT_FALLBACK_KEY, JSON.stringify(current))
    } catch {
      /* ignore */
    }
  }
}

// --- Subservicios personalizados por usuario (Plex, Emby, Datacenter…) ---

export const PRESET_SUBSERVICES = ['Plex', 'Emby', 'Jellyfin', 'Datacenter', 'IPTV', 'Music'] as const

// Logos oficiales por subservicio (Simple Icons CDN, SVG con color de marca)
export const OFFICIAL_SUBSERVICE_LOGOS: Record<string, string> = {
  plex: 'https://cdn.simpleicons.org/plex/e5a00d',
  emby: 'https://cdn.simpleicons.org/emby/52b54b',
  jellyfin: 'https://cdn.simpleicons.org/jellyfin/00a4dc',
}

export function officialLogoForSubservice(subservice?: string | null): string | null {
  if (!subservice) return null
  return OFFICIAL_SUBSERVICE_LOGOS[subservice.trim().toLowerCase()] ?? null
}

const SUBS_FALLBACK_KEY = 'sp_custom_subs_global'

export function getUserCustomSubservices(userId?: string): string[] {
  const keys = [
    userId ? `sp_custom_subs_${userId}` : null,
    SUBS_FALLBACK_KEY,
  ].filter((k): k is string => !!k)

  const set = new Set<string>()
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            if (typeof c === 'string' && c.trim()) set.add(c.trim())
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function saveUserCustomSubservice(userId: string | undefined, subservice: string): string[] {
  const trimmed = subservice.trim()
  if (!trimmed) return getUserCustomSubservices(userId)
  const current = getUserCustomSubservices(userId)
  const exists = current.some((c) => c.toLowerCase() === trimmed.toLowerCase())
  const updated = exists ? current : [...current, trimmed]

  try {
    if (userId) {
      localStorage.setItem(`sp_custom_subs_${userId}`, JSON.stringify(updated))
    }
    localStorage.setItem(SUBS_FALLBACK_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

// --- Preferencia de visualización por panel (Marco embebido vs Acceso directo) ---

const PANEL_VIEW_PREF_KEY = 'sp_panel_view_prefs'

export function getPanelEmbedPreference(
  userId: string | undefined,
  panelId: string,
  defaultKind?: 'own' | 'third'
): 'frame' | 'launcher' {
  if (!panelId) return 'frame'
  const keys = [
    userId ? `${PANEL_VIEW_PREF_KEY}_${userId}` : null,
    PANEL_VIEW_PREF_KEY,
  ].filter((k): k is string => !!k)

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const map = JSON.parse(raw) as Record<string, 'frame' | 'launcher'>
        if (map && map[panelId]) {
          return map[panelId]
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Por defecto la primera vez: 'frame' para abrir directamente
  return defaultKind === 'own' ? 'frame' : 'frame'
}

export function savePanelEmbedPreference(
  userId: string | undefined,
  panelId: string,
  mode: 'frame' | 'launcher'
): void {
  if (!panelId) return
  const keyUser = userId ? `${PANEL_VIEW_PREF_KEY}_${userId}` : null
  const keys = [keyUser, PANEL_VIEW_PREF_KEY].filter((k): k is string => !!k)

  for (const key of keys) {
    try {
      let map: Record<string, 'frame' | 'launcher'> = {}
      const raw = localStorage.getItem(key)
      if (raw) {
        map = JSON.parse(raw) || {}
      }
      map[panelId] = mode
      localStorage.setItem(key, JSON.stringify(map))
    } catch {
      /* ignore */
    }
  }
}
