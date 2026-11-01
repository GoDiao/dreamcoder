import { t } from '../i18n'
import { browserReferencePreview, type BrowserReferenceItem } from './browserReferences'

export function browserReferenceAttachment(item: BrowserReferenceItem) {
  const { sensitive, ...preview } = browserReferencePreview(item)
  return sensitive ? { ...preview, quote: t('browser.sensitiveElement') } : preview
}
