import { z } from 'zod/v4'

export const AutoPermissionSettingsSchema = z.object({
  providerId: z.string().nullable(),
  modelId: z.string(),
  privacyNoticeVersion: z.number().int().nonnegative(),
})

export type AutoPermissionSettings = z.infer<typeof AutoPermissionSettingsSchema>

export const DEFAULT_AUTO_PERMISSION_SETTINGS: AutoPermissionSettings = {
  providerId: null,
  modelId: '',
  privacyNoticeVersion: 0,
}
