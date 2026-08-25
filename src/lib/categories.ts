// Gestor de categorías personalizadas por usuario

export function getUserCustomCategories(userId: string): string[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(`sp_custom_cats_${userId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === 'string' && c.trim()) : []
  } catch {
    return []
  }
}

export function saveUserCustomCategory(userId: string, category: string): string[] {
  if (!userId) return []
  const trimmed = category.trim()
  if (!trimmed) return getUserCustomCategories(userId)
  const current = getUserCustomCategories(userId)
  const exists = current.some((c) => c.toLowerCase() === trimmed.toLowerCase())
  const updated = exists ? current : [...current, trimmed]
  try {
    localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

export function renameUserCustomCategory(userId: string, oldName: string, newName: string): string[] {
  if (!userId) return []
  const trimmedOld = oldName.trim().toLowerCase()
  const trimmedNew = newName.trim()
  if (!trimmedNew) return getUserCustomCategories(userId)
  const current = getUserCustomCategories(userId)
  const updated = current.map((c) => (c.toLowerCase() === trimmedOld ? trimmedNew : c))
  if (!updated.some((c) => c.toLowerCase() === trimmedNew.toLowerCase())) {
    updated.push(trimmedNew)
  }
  try {
    localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}

export function removeUserCustomCategory(userId: string, category: string): string[] {
  if (!userId) return []
  const trimmed = category.trim().toLowerCase()
  const current = getUserCustomCategories(userId)
  const updated = current.filter((c) => c.toLowerCase() !== trimmed)
  try {
    localStorage.setItem(`sp_custom_cats_${userId}`, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
  return updated
}
