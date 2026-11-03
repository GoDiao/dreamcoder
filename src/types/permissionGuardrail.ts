import { z } from 'zod/v4'

export const PermissionGuardrailPresetSchema = z.enum([
  'fewerPrompts',
  'safetyNet',
])

export const PermissionGuardrailSettingsSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().nullable(),
  modelId: z.string(),
  preset: PermissionGuardrailPresetSchema,
  threshold: z.number().min(0).max(1),
  privacyNoticeVersion: z.number().int().nonnegative(),
})

export type PermissionGuardrailPreset = z.infer<typeof PermissionGuardrailPresetSchema>
export type PermissionGuardrailSettings = z.infer<typeof PermissionGuardrailSettingsSchema>

export const DEFAULT_PERMISSION_GUARDRAIL_SETTINGS: PermissionGuardrailSettings = {
  enabled: false,
  providerId: null,
  modelId: '',
  preset: 'safetyNet',
  threshold: 0.95,
  privacyNoticeVersion: 0,
}
