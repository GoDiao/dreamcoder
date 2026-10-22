import { z } from 'zod'

import providerPresetsJson from './providerPresets.json'
import {
  ApiFormatSchema,
  ProviderAuthStrategySchema,
  ProviderModelsSchema,
} from '../types/provider.js'

const ProviderPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  defaultModels: ProviderModelsSchema,
  defaultFastModel: z.string().min(1).optional(),
  needsApiKey: z.boolean(),
  websiteUrl: z.string(),
  apiKeyUrl: z.string().optional(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  defaultEnv: z.record(z.string(), z.string()).optional(),
  modelContextWindows: z.record(
    z.string().min(1),
    z.number().int().min(16000).max(10000000),
  ).optional(),
})

const ProviderPresetsSchema = z.array(ProviderPresetSchema)

export type ProviderPreset = z.infer<typeof ProviderPresetSchema>

export const PROVIDER_PRESETS = ProviderPresetsSchema.parse(providerPresetsJson)
