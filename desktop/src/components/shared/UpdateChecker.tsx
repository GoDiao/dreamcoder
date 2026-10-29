import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/card'
import { Progress } from './ui/progress'
import { Button } from './ui/button'
import { useEffect, useId } from 'react'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { useUpdateStore } from '../../stores/updateStore'
import { formatBytes } from '../../lib/formatBytes'

export function UpdateChecker() {
  const id = useId()
  const status = useUpdateStore((state) => state.status)
  const availableVersion = useUpdateStore((state) => state.availableVersion)
  const shouldPrompt = useUpdateStore((state) => state.shouldPrompt)
  const initialize = useUpdateStore((state) => state.initialize)
  const visible = isDesktopRuntime() && shouldPrompt && !!availableVersion && ['available', 'downloading', 'restarting'].includes(status)

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => {
    if (visible) toast.custom(() => <UpdatePrompt />, { id, duration: Infinity, position: 'top-right', dismissible: false })
    else toast.dismiss(id)
    return () => { toast.dismiss(id) }
  }, [id, visible])

  return null
}

function UpdatePrompt() {
  const t = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const releaseNotes = useUpdateStore((s) => s.releaseNotes)
  const progressPercent = useUpdateStore((s) => s.progressPercent)
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes)
  const totalBytes = useUpdateStore((s) => s.totalBytes)
  const error = useUpdateStore((s) => s.error)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const dismissPrompt = useUpdateStore((s) => s.dismissPrompt)

  const hasKnownProgress = typeof totalBytes === 'number' && totalBytes > 0
  const downloadedText = formatBytes(downloadedBytes)
  const statusText =
    status === 'restarting'
      ? t('update.restarting')
      : status === 'downloading'
        ? hasKnownProgress
          ? t('update.downloading')
          : t('update.progressBytes', { downloaded: downloadedText })
        : null

  if (!availableVersion) return null

  return (
    <Card className="w-full gap-3 py-4">
      <CardHeader>
        <CardTitle>
          {t('update.available', { version: availableVersion })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {releaseNotes && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-surface)]/70 px-3 py-2">
            <MarkdownRenderer
              content={releaseNotes}
              className="text-xs leading-5 text-[var(--color-text-secondary)] [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:text-xs [&_h2]:font-semibold [&_p]:my-1.5 [&_p]:text-xs [&_p]:leading-5 [&_ul]:my-1.5 [&_ol]:my-1.5"
            />
          </div>
        )}

        {(status === 'downloading' || status === 'restarting') && (
          <div className="mt-3">
            <Progress aria-label={t('update.downloading')} value={hasKnownProgress || status === 'restarting' ? Math.min(progressPercent, 100) : null} />
            {statusText && (
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                {statusText}
                {status === 'downloading' && hasKnownProgress ? ` ${progressPercent}%` : ''}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-[var(--color-error)]">
            {t('update.failed', { error })}
          </p>
        )}

      </CardContent>
        {status === 'available' && (
          <CardFooter className="gap-2">
            <Button size="sm"
              onClick={() => void installUpdate()}
            >
              {t('update.now')}
            </Button>
            <Button size="sm" variant="ghost"
              onClick={dismissPrompt}
            >
              {t('update.later')}
            </Button>
          </CardFooter>
        )}
    </Card>
  )
}
