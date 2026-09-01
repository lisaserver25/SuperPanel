import { useEffect, useState } from 'react'

const MQ = '(max-width: 767px)' // md de Tailwind: <768px se considera móvil

/** Devuelve true cuando el viewport está en rango móvil (Android / iOS / ventana estrecha). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MQ).matches : false
  )

  useEffect(() => {
    const mq = window.matchMedia(MQ)
    function onChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches)
    }
    mq.addEventListener('change', onChange)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

/** Detecta si la app está instalada / en modo standalone (PWA añadida a inicio). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    // iOS Safari expone navigator.standalone
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
