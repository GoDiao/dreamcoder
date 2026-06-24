import { describe, expect, test } from 'bun:test'
import { parseConfig } from './config'
import { describeRun } from './runner'

describe('config runner', () => {
  test('parses structured config', () => {
    expect(parseConfig('enabled retries=3')).toEqual({ enabled: true, retries: 3 })
  })

  test('describes enabled retry runs', () => {
    expect(describeRun('enabled retries=3')).toBe('enabled with 3 retries')
  })

  test('describes disabled runs', () => {
    expect(describeRun('disabled retries=0')).toBe('disabled')
  })
})
