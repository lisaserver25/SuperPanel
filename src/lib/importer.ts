// ============================================================================
// Importador masivo de paneles desde listados de texto.
// Formato soportado (tolerante a emojis y mayúsculas):
//   🖥 NOMBRE [Plex]
//      📍 IP: 1.2.3.4
//      👤 Usuario: referencia (no se usa para login)
//      📧 Email: login@dominio
//      🔑 Contraseña: secret
// También acepta URL:/Servidor:/Host: en lugar de IP: y Password:/Pass:.
// ============================================================================

export interface ParsedPanelEntry {
  name: string
  url: string
  loginEmail: string
  loginPassword: string
  referenceUser?: string
  /** Tag de servicio detectado entre corchetes del nombre, ej. "Plex" */
  serviceTag?: string
}

function cleanField(s: string): string {
  return s.trim().replace(/^[—–-]\s*/, '')
}

function extractName(line: string): string {
  return line
    .replace(/🖥|💻|🖥️/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
}

export function parsePanelListing(text: string): ParsedPanelEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: ParsedPanelEntry[] = []
  let current: Partial<ParsedPanelEntry> | null = null

  const flush = () => {
    if (current && (current.url || current.loginEmail)) {
      entries.push({
        name: current.name?.trim() || current.url?.trim() || 'Panel',
        url: current.url?.trim() || '',
        loginEmail: current.loginEmail?.trim() || '',
        loginPassword: current.loginPassword?.trim() || '',
        referenceUser: current.referenceUser?.trim() || undefined,
      })
    }
    current = null
  }

  const namePattern = /^(?:[^[\]]*)\[([^\]]+)\]\s*$/ // "CARACOL [Plex]"

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const isNameLine = line.includes('🖥') || namePattern.test(line.replace(/🖥|💻/g, '').trim())
    if (isNameLine) {
      flush()
      const label = extractName(line)
      // El tag entre corchetes del nombre es el subservicio (ej. [Plex])
      const tagMatch = label.match(/\[([^\]]+)\]\s*$/)
      current = {
        name: (tagMatch ? label.replace(/\s*\[[^\]]+\]\s*$/, '') : label).trim() || label,
        serviceTag: tagMatch ? tagMatch[1].trim() : undefined,
      }
      continue
    }

    if (!current) continue

    let m: RegExpMatchArray | null

    if ((m = line.match(/(?:📍\s*)?(?:IP|URL|Servidor|Host)\s*:\s*(.+)/i))) {
      const target = cleanField(m[1])
      current.url = /^https?:\/\//i.test(target) ? target : `http://${target}`
      continue
    }

    if ((m = line.match(/(?:👤\s*)?Usuario\s*:\s*(.+)/i))) {
      current.referenceUser = cleanField(m[1])
      continue
    }

    if ((m = line.match(/(?:📧\s*)?Email\s*:\s*(.+)/i))) {
      current.loginEmail = cleanField(m[1])
      continue
    }

    if ((m = line.match(/(?:🔑\s*)?(?:Contraseña|Contrasena|Password|Pass)\s*:\s*(.+)/i))) {
      current.loginPassword = cleanField(m[1])
      continue
    }
  }

  flush()

  // Solo entradas con URL utilizable
  return entries.filter((e) => e.url)
}
