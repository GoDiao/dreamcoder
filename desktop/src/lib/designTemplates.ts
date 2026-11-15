import type { Locale, TranslationKey } from '../i18n'
import type { DesignTemplate, DesignTemplateCategory, DesignText } from '../types/design'
import { matchesQuery } from './textMatch'

export const DESIGN_CATEGORY_LABELS: Record<DesignTemplateCategory, TranslationKey> = {
  web: 'design.category.web',
  prototype: 'design.category.prototype',
  slides: 'design.category.slides',
}

export const DESIGN_PLATFORM_LABELS: Record<NonNullable<DesignTemplate['platform']>, TranslationKey> = {
  desktop: 'design.platform.desktop',
  mobile: 'design.platform.mobile',
}

export function localizedText(text: DesignText, locale: Locale): string {
  return text[locale] || text.en
}

export function filterDesignTemplates(
  templates: readonly DesignTemplate[],
  categories: readonly DesignTemplateCategory[],
  query: string,
): DesignTemplate[] {
  return templates.filter((template) => {
    if (!categories.includes(template.category)) return false
    return matchesQuery(
      [template.id, template.title.en, template.title.zh, template.description.en, template.description.zh, ...template.tags],
      query,
    )
  })
}
