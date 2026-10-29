import { BotIcon, ChevronUpIcon, CircleAlertIcon, CircleCheckIcon, CircleEllipsisIcon, CircleIcon, ExternalLinkIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { useTeamStore } from '../../stores/teamStore'
import { useTranslation } from '../../i18n'
import type { TeamMember } from '../../types/team'

const memberStatusConfig = {
  running: {
    icon: CircleEllipsisIcon,
    color: 'var(--color-warning)',
    pulse: true,
  },
  idle: {
    icon: CircleIcon,
    color: 'var(--color-text-tertiary)',
    pulse: false,
  },
  completed: {
    icon: CircleCheckIcon,
    color: 'var(--color-success)',
    pulse: false,
  },
  error: {
    icon: CircleAlertIcon,
    color: 'var(--color-error)',
    pulse: false,
  },
} as const

export function TeamStatusBar() {
  const t = useTranslation()
  const { activeTeam, openMemberSession } = useTeamStore()
  const [expanded, setExpanded] = useState(true)

  if (!activeTeam) return null

  const members = activeTeam.members.filter(
    (m) => !activeTeam.leadAgentId || m.agentId !== activeTeam.leadAgentId,
  )
  const runningCount = members.filter((m) => m.status === 'running').length
  // An idle teammate has finished its work and waits for messages.
  const completedCount = members.filter((m) => m.status === 'completed' || m.status === 'idle').length
  const totalCount = members.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const allDone = runningCount === 0 && totalCount > 0

  return (
    <div className="shrink-0 px-8">
      <div className="mx-auto max-w-[860px] rounded-lg border border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-lowest)] overflow-hidden mb-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-container-low)] transition-colors bg-[var(--color-surface-container)]"
        >
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-brand)]/10">
            <UsersIcon className="shrink-0 text-[var(--color-brand)]" aria-hidden="true" size={14} />
          </div>

          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            {t('teams.team')} {activeTeam.name}
          </span>

          <div className="flex-1 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden max-w-[200px]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progressPercent}%`,
                backgroundColor: allDone ? 'var(--color-success)' : 'var(--color-brand)',
              }}
            />
          </div>

          <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
            {completedCount}/{totalCount}
          </span>

          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-warning)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
              {runningCount} {t('teams.running')}
            </span>
          )}

          <ChevronUpIcon className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} aria-hidden="true" size={14} />
        </button>

        {expanded && (
          <div className="px-4 pb-2 pt-1 flex flex-col gap-0.5 max-h-[240px] overflow-y-auto border-t border-[var(--color-outline-variant)]/20">
            {members.map((member) => (
              <MemberRow key={member.agentId} member={member} onView={() => openMemberSession(member)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemberRow({ member, onView }: { member: TeamMember; onView: () => void }) {
  const config = memberStatusConfig[member.status] || memberStatusConfig.idle

  return (
    <button
      onClick={onView}
      className="w-full flex items-center gap-2 py-1.5 px-1 rounded-md text-left hover:bg-[var(--color-surface-container-low)] transition-colors group"
    >
      <config.icon className={`shrink-0 ${config.pulse ? 'animate-pulse-dot' : ''}`}
        style={{ color: config.color }} aria-hidden="true" size={16} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <BotIcon className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" size={12} />
          <span className={`text-xs ${
            member.status === 'completed'
              ? 'text-[var(--color-text-tertiary)]'
              : 'text-[var(--color-text-primary)]'
          }`}>
            {member.role}
          </span>
        </div>

        {member.status === 'running' && member.currentTask && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
            <span className="text-[10px] text-[var(--color-warning)] truncate">
              {member.currentTask}
            </span>
          </div>
        )}
      </div>

      <ExternalLinkIcon className="shrink-0 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" size={14} />
    </button>
  )
}
