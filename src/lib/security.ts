// ============================================================================
// SuperPaneles · Módulo de Seguridad y Protección de Privacidad
// - Sanitización profunda de la consola del navegador contra fugas de credenciales.
// - Redacción de contraseñas, tokens JWT, claves Supabase y datos sensibles.
// - Supresión de logs informativos en producción.
// - Intercepción de errores no controlados para evitar exposición en DevTools.
// ============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /jwt/i,
  /api[_-]?key/i,
  /anon[_-]?key/i,
  /service[_-]?role/i,
  /auth[_-]?password/i,
  /password[_-]?enc/i,
  /p[_-]?password/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
]

const SENSITIVE_VALUE_PATTERNS = [
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWTs
  /sbp_[a-zA-Z0-9]{20,}/g, // Supabase service keys
]

/**
 * Enmascara direcciones de correo electrónico para evitar exposición visual o en logs.
 * Ej: "usuario@ejemplo.com" -> "u***o@ejemplo.com"
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return ''
  const trimmed = email.trim()
  const atIdx = trimmed.indexOf('@')
  if (atIdx <= 1) return '***@' + (trimmed.slice(atIdx + 1) || '***')
  
  const userPart = trimmed.slice(0, atIdx)
  const domainPart = trimmed.slice(atIdx + 1)
  
  if (userPart.length <= 3) {
    return `${userPart[0]}***@${domainPart}`
  }
  return `${userPart[0]}***${userPart[userPart.length - 1]}@${domainPart}`
}

/**
 * Obtiene el nombre visual seguro del usuario para la interfaz sin exponer el email completo.
 */
export function safeUserDisplayName(
  profile?: { full_name?: string | null; email?: string | null } | null,
  user?: { email?: string | null } | null
): string {
  if (profile?.full_name && profile.full_name.trim().length > 0) {
    return profile.full_name.trim()
  }
  const email = profile?.email || user?.email
  if (email) {
    return maskEmail(email)
  }
  return 'Usuario'
}

/**
 * Sanitiza recursivamente cualquier argumento pasado a la consola.
 */
function sanitizeValue(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value
  
  if (typeof value === 'string') {
    let sanitized = value
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED_TOKEN]')
    }
    return sanitized
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen))
  }

  // Si es un objeto Error
  if (value instanceof Error) {
    const cleanErr: Record<string, unknown> = {
      name: value.name,
      message: sanitizeValue(value.message, seen),
    }
    return cleanErr
  }

  const cleanObj: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
    if (isSensitiveKey) {
      cleanObj[key] = '[REDACTED]'
    } else {
      cleanObj[key] = sanitizeValue(val, seen)
    }
  }
  return cleanObj
}

/**
 * Instala el escudo de seguridad en el entorno del navegador.
 */
export function installSecurityShield(): void {
  if (typeof window === 'undefined') return

  const isProd = import.meta.env.PROD
  const noop = () => {}

  // En producción, silenciamos logs ordinarios para evitar cualquier filtración o saturación
  if (isProd) {
    console.log = noop
    console.info = noop
    console.debug = noop
    console.trace = noop
    console.table = noop
  } else {
    const origLog = console.log
    const origInfo = console.info
    const origDebug = console.debug
    
    console.log = (...args: unknown[]) => origLog.apply(console, args.map((a) => sanitizeValue(a)))
    console.info = (...args: unknown[]) => origInfo.apply(console, args.map((a) => sanitizeValue(a)))
    console.debug = (...args: unknown[]) => origDebug.apply(console, args.map((a) => sanitizeValue(a)))
  }

  // Sanitizamos siempre console.warn y console.error
  const origWarn = console.warn
  const origError = console.error

  console.warn = (...args: unknown[]) => {
    origWarn.apply(console, args.map((a) => sanitizeValue(a)))
  }

  console.error = (...args: unknown[]) => {
    origError.apply(console, args.map((a) => sanitizeValue(a)))
  }

  // Interceptar promesas no capturadas para que errores con headers/payloads no salgan crudos
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason) {
      const sanitizedReason = sanitizeValue(event.reason)
      if (typeof sanitizedReason === 'object' && sanitizedReason !== null) {
        // Prevenir la salida por defecto que vuelca el stack trace completo si contiene tokens
        event.preventDefault()
        console.error('Unhandled Rejection:', (sanitizedReason as { message?: string }).message || '[Error protegido]')
      }
    }
  })
}

