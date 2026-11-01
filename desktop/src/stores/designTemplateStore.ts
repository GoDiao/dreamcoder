import { designApi } from '../api/design'
import type { DesignTemplate } from '../types/design'
import { createCatalogStore } from './catalogStore'

export const useDesignTemplateStore = createCatalogStore<DesignTemplate>(async () => (await designApi.templates()).templates)
