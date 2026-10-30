import { copyTextToClipboard } from '../components/chat/clipboard'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'

export function useCopyAndNotify() {
  const t = useTranslation()
  const addToast = useUIStore((state) => state.addToast)
  return async (text: string, success?: string) => {
    const copied = await copyTextToClipboard(text)
    if (!copied) addToast({ type: 'error', message: t('common.copyFailed') })
    else if (success) addToast({ type: 'success', message: success })
    return copied
  }
}
