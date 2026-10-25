import { api } from './client'

export type ConfigDirectories = {
  configDir: string
  defaultConfigDir: string
}

export const statusApi = {
  getConfigDirectories() {
    return api.get<ConfigDirectories>('/api/status/diagnostics')
  },
}
