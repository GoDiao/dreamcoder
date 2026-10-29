import { useEffect, useState } from 'react'

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'

function getInitialMobileViewport(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

export function useViewportQuery(query: string) {
  const [isMobile, setIsMobile] = useState(() => getInitialMobileViewport(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia(query)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
    } else {
      mediaQuery.addListener(handleChange)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleChange)
      } else {
        mediaQuery.removeListener(handleChange)
      }
    }
  }, [query])

  return isMobile
}

export function useMobileViewport() {
  return useViewportQuery(MOBILE_VIEWPORT_QUERY)
}
