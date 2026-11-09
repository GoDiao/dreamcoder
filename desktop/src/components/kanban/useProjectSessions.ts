import { useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'

export function useProjectSessions(project: string | undefined) {
  const sessions = useSessionStore((state) => state.sessions)
  return useMemo(
    () => sessions.filter((session) => session.projectRoot === project).map((session) => ({ id: session.id, title: session.title })),
    [project, sessions],
  )
}
