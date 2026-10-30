import type { ThemeMode } from '../types/settings'

export function themeColorScheme(theme: ThemeMode): 'light' | 'dark' {
  return theme === 'dark' || theme === 'midnight' || theme === 'aurora' ? 'dark' : 'light'
}
