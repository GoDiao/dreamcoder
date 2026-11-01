import { designApi } from '../api/design'
import type { DesignSystem } from '../types/design'
import { createCatalogStore } from './catalogStore'

export const useDesignSystemStore = createCatalogStore<DesignSystem>(async () => (await designApi.systemCatalog()).systems)
