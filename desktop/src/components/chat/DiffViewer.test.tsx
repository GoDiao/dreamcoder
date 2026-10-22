import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { DiffViewer } from './DiffViewer'

describe('DiffViewer', () => {
  it('shows the file header at once and renders the diff body after it loads on first use', async () => {
    const { container } = render(
      <DiffViewer
        filePath="src/greeting.ts"
        oldString={'const greeting = "hello"\nexport default greeting'}
        newString={'const greeting = "hello, world"\nexport default greeting'}
      />,
    )

    expect(screen.getByText('src/greeting.ts')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading diff' })).toHaveStyle({ height: '60px' })

    const body = container.querySelector('.max-h-\\[400px\\]') as HTMLElement
    await within(body).findByText('world', { exact: false })
    expect(screen.queryByRole('status', { name: 'Loading diff' })).not.toBeInTheDocument()
  })
})
