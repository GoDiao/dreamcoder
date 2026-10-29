import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bug, ChevronRight, Ellipsis, Folders, Globe, Keyboard, Settings2 } from 'lucide-react'
import { useTranslation, type Locale } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMenuAction } from '../../hooks/useMenuAction'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../shared/ui/dropdown-menu'
import { Button } from '../shared/ui/button'
import { Tooltip } from '../shared/Tooltip'

const LANGUAGE_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

type SidebarMoreMenuProps = {
  collapsed: boolean
  onOpenProjectManagement: () => void
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onReportProblem: () => void
}

export function SidebarMoreMenu({ collapsed, onOpenProjectManagement, onOpenSettings, onOpenShortcuts, onReportProblem }: SidebarMoreMenuProps) {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const [view, setView] = useState<'main' | 'language' | null>(null)
  const menu = useMenuAction()
  const content = useRef<HTMLDivElement>(null)
  const currentLanguage = LANGUAGE_OPTIONS.find((option) => option.value === locale)?.label ?? locale

  useEffect(() => {
    content.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
  }, [view])

  return (
    <DropdownMenu open={view !== null} onOpenChange={(open) => setView(open ? 'main' : null)}>
      <Tooltip content={collapsed ? t('sidebar.more') : undefined}>
        <DropdownMenuTrigger asChild>
          <Button ref={menu.triggerRef} variant="ghost" aria-label={t('sidebar.more')} className={collapsed ? 'h-10 w-10' : 'h-9 w-full justify-start gap-2.5'}>
            <Ellipsis aria-hidden="true" />
            {!collapsed && <span className="truncate">{t('sidebar.more')}</span>}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        ref={content}
        aria-labelledby={undefined}
        aria-label={t(view === 'language' ? 'sidebar.language' : 'sidebar.more')}
        data-testid="sidebar-more-menu"
        side="top"
        align="start"
        className="min-w-60"
        onCloseAutoFocus={menu.onCloseAutoFocus}
      >
        {view === 'main' ? <>
          <DropdownMenuItem onSelect={() => menu.runAfterClose(onOpenProjectManagement)}><Folders aria-hidden="true" />{t('sidebar.projectManagement')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => menu.runAfterClose(onOpenSettings)}><Settings2 aria-hidden="true" />{t('sidebar.settings')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setView('language') }}>
            <Globe aria-hidden="true" />{`${t('sidebar.language')} · ${currentLanguage}`}<ChevronRight className="ml-auto" aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => menu.runAfterClose(onOpenShortcuts)}><Keyboard aria-hidden="true" />{t('sidebar.shortcuts')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => menu.runAfterClose(onReportProblem)}><Bug aria-hidden="true" />{t('reportProblem.menuItem')}</DropdownMenuItem>
        </> : <>
          <DropdownMenuRadioGroup value={locale} onValueChange={(value) => {
            const option = LANGUAGE_OPTIONS.find((candidate) => candidate.value === value)
            if (option) useSettingsStore.getState().setLocale(option.value)
          }}>
            {LANGUAGE_OPTIONS.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setView('main') }}><ArrowLeft aria-hidden="true" />{t('sidebar.backToMore')}</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
