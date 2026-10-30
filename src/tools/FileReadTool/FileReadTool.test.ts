import { describe, expect, it } from 'bun:test'
import { FileReadTool } from './FileReadTool.js'

describe('FileReadTool input', () => {
  it('treats an empty page range as no page range', () => {
    const schema = FileReadTool.inputSchema
    expect(schema.parse({ file_path: '/tmp/a.md', pages: '' })).toEqual({ file_path: '/tmp/a.md' })
    expect(schema.parse({ file_path: '/tmp/a.pdf', pages: '1-5' })).toEqual({ file_path: '/tmp/a.pdf', pages: '1-5' })
    expect(schema.safeParse({ file_path: '/tmp/a.pdf', pages: 3 }).success).toBe(false)
  })
})
