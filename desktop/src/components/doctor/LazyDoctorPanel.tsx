import { Component, lazy, Suspense, type ReactNode } from 'react'

const DoctorPanel = lazy(() => import('./DoctorPanel').then((m) => ({ default: m.DoctorPanel })))

type DoctorPanelProps = {
  compact?: boolean
}

type GuardProps = { children: ReactNode }
type GuardState = { failed: boolean }

// The Doctor panel is shown on error screens. If its chunk cannot load there, render nothing
// rather than letting the failure escape the screen that is already reporting an error.
class DoctorPanelLoadGuard extends Component<GuardProps, GuardState> {
  state: GuardState = { failed: false }

  static getDerivedStateFromError(): GuardState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** DoctorPanel loaded on first render, for screens on the startup path. */
export function LazyDoctorPanel(props: DoctorPanelProps) {
  return (
    <DoctorPanelLoadGuard>
      <Suspense fallback={null}>
        <DoctorPanel {...props} />
      </Suspense>
    </DoctorPanelLoadGuard>
  )
}
