import { Component, lazy, Suspense, type ReactNode } from 'react'

const DoctorPanel = lazy(() => import('./DoctorPanel').then((m) => ({ default: m.DoctorPanel })))

type DoctorPanelProps = {
  compact?: boolean
}

type GuardProps = { children: ReactNode }
type GuardState = { failed: boolean }

class DoctorPanelLoadGuard extends Component<GuardProps, GuardState> {
  state: GuardState = { failed: false }

  static getDerivedStateFromError(): GuardState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function LazyDoctorPanel(props: DoctorPanelProps) {
  return (
    <DoctorPanelLoadGuard>
      <Suspense fallback={null}>
        <DoctorPanel {...props} />
      </Suspense>
    </DoctorPanelLoadGuard>
  )
}
