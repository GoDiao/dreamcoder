import { z } from 'zod'

import { CompleteModelRuleFieldsSchema, ModelRuleFieldsSchema } from './modelRules.js'
import { ApiFormatSchema } from './provider.js'

const RuleSourceSchema = z
  .object({
    url: z.string().url(),
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['verified', 'unverified', 'conflict']),
    note: z.string().min(1).optional(),
  })
  .strict()
export type RuleSource = z.infer<typeof RuleSourceSchema>

const ModelRuleEntrySchema = z
  .object({
    match: z.object({ modelPrefix: z.string().min(1) }).strict(),
    source: RuleSourceSchema,
    rules: ModelRuleFieldsSchema,
  })
  .strict()

const SiteRuleEntrySchema = z
  .object({
    match: z
      .object({
        host: z.string().min(1),
        apiFormat: ApiFormatSchema,
        modelPrefix: z.string().min(1).optional(),
      })
      .strict(),
    source: RuleSourceSchema,
    rules: ModelRuleFieldsSchema,
  })
  .strict()
export type SiteRuleEntry = z.infer<typeof SiteRuleEntrySchema>

export const ModelRulesTableSchema = z
  .object({
    fallback: z.object({ rules: CompleteModelRuleFieldsSchema }).strict(),
    formats: z
      .object({
        anthropic: ModelRuleFieldsSchema,
        openai_chat: ModelRuleFieldsSchema,
        openai_responses: ModelRuleFieldsSchema,
      })
      .strict(),
    models: z.array(ModelRuleEntrySchema),
    sites: z.array(SiteRuleEntrySchema),
  })
  .strict()
export type ModelRulesTable = z.infer<typeof ModelRulesTableSchema>
