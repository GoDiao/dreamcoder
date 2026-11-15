import { describe, expect, it } from 'vitest'
import { getPathParts } from './pathParts'

describe('getPathParts', () => {
  it('splits a path into the file name and the folder it is in', () => {
    expect(getPathParts('src/components/chat/Card.tsx')).toEqual({ name: 'Card.tsx', dir: 'src/components/chat' })
    expect(getPathParts('README.md')).toEqual({ name: 'README.md', dir: '' })
    expect(getPathParts('docs/')).toEqual({ name: 'docs', dir: '' })
  })

  it('keeps the leading slash of a folder outside the workspace', () => {
    expect(getPathParts('/tmp/out/report.html')).toEqual({ name: 'report.html', dir: '/tmp/out' })
    expect(getPathParts('/report.html')).toEqual({ name: 'report.html', dir: '' })
  })
})
