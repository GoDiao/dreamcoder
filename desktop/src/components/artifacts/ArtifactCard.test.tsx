import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getBaseUrl: () => 'http://127.0.0.1:3456',
}))

import type { ArtifactListItem } from '../../types/artifact'
import { ArtifactCard } from './ArtifactCard'

const item = (overrides: Partial<ArtifactListItem> = {}): ArtifactListItem => ({
  name: 'report',
  artifactsDir: '/repo/dc_artifacts',
  dir: '/repo/dc_artifacts/report',
  workDir: '/repo',
  projectRoot: '/repo',
  branch: null,
  id: 'id-report',
  lastOpenedAt: null,
  entryMissing: false,
  thumbnailMtimeMs: null,
  origin: null,
  sessions: [],
  manifest: { version: 1, id: 'id-report', kind: 'page', title: 'Report', entry: 'index.html' },
  error: null,
  latestMtimeMs: 1,
  ...overrides,
})

describe('ArtifactCard thumbnail', () => {
  afterEach(cleanup)

  it('shows the saved thumbnail, versioned by the time it was taken', () => {
    const { container } = render(<ArtifactCard item={item({ thumbnailMtimeMs: 99 })} layout="grid" onOpen={() => undefined} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('http://127.0.0.1:3456/api/artifacts/thumbnail?id=id-report&v=99')
  })

  it('shows the type icon when there is no thumbnail', () => {
    const { container } = render(<ArtifactCard item={item()} layout="grid" onOpen={() => undefined} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to the type icon when the image cannot be loaded', () => {
    const { container } = render(<ArtifactCard item={item({ thumbnailMtimeMs: 5 })} layout="list" onOpen={() => undefined} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Report')).toBeInTheDocument()
  })
})

describe('ArtifactCard canvas', () => {
  afterEach(cleanup)

  it('opens a canvas like any other artifact', () => {
    const onOpen = vi.fn()
    const canvas = item({ manifest: { version: 1, id: 'id-report', kind: 'canvas', title: 'Flow', entry: 'index.html' } })
    render(<ArtifactCard item={canvas} layout="grid" onOpen={onOpen} />)
    const card = screen.getByRole('button', { name: /Flow/ })
    expect(card).toBeEnabled()
    expect(screen.getByText('Canvas')).toBeInTheDocument()
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith(canvas)
  })
})

