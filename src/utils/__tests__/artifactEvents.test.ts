import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { normalize } from 'node:path'
import { getIsInteractive, setIsInteractive } from '../../bootstrap/state.js'
import { emitArtifactWritten, emitArtifactWrittenAt } from '../artifactEvents.js'
import { drainSdkEvents } from '../sdkEventQueue.js'

let wasInteractive: boolean

beforeEach(() => {
  wasInteractive = getIsInteractive()
  setIsInteractive(false)
  drainSdkEvents()
})

afterEach(() => {
  drainSdkEvents()
  setIsInteractive(wasInteractive)
})

describe('emitArtifactWritten', () => {
  test('emits an event for Write, Edit and NotebookEdit on a dc_artifacts path', () => {
    emitArtifactWritten('Write', { file_path: '/work/dc_artifacts/a/index.html' })
    emitArtifactWritten('Edit', { file_path: '/work/dc_artifacts/a/style.css' }, 'agent-1')
    emitArtifactWritten('NotebookEdit', { notebook_path: '/work/dc_artifacts/a/n.ipynb' })
    const events = drainSdkEvents()
    expect(events.map((event) => ({ ...event, uuid: undefined, session_id: undefined }))).toEqual([
      { type: 'system', subtype: 'artifact_written', path: normalize('/work/dc_artifacts/a/index.html'), tool_name: 'Write', uuid: undefined, session_id: undefined },
      { type: 'system', subtype: 'artifact_written', path: normalize('/work/dc_artifacts/a/style.css'), tool_name: 'Edit', agent_id: 'agent-1', uuid: undefined, session_id: undefined },
      { type: 'system', subtype: 'artifact_written', path: normalize('/work/dc_artifacts/a/n.ipynb'), tool_name: 'NotebookEdit', uuid: undefined, session_id: undefined },
    ])
  })

  test('ignores other paths, other tools and malformed input', () => {
    emitArtifactWritten('Write', { file_path: '/work/src/index.html' })
    emitArtifactWritten('Read', { file_path: '/work/dc_artifacts/a/index.html' })
    emitArtifactWritten('Bash', { command: 'echo > /work/dc_artifacts/a/x' })
    emitArtifactWritten('Write', null)
    emitArtifactWritten('Write', { file_path: '' })
    expect(drainSdkEvents()).toEqual([])
  })

  test('emits nothing in an interactive session', () => {
    setIsInteractive(true)
    emitArtifactWritten('Write', { file_path: '/work/dc_artifacts/a/index.html' })
    setIsInteractive(false)
    expect(drainSdkEvents()).toEqual([])
  })
})

describe('emitArtifactWrittenAt', () => {
  test('emits for a dc_artifacts path of any tool and ignores other paths', () => {
    emitArtifactWrittenAt('/work/dc_artifacts/a/artifact.json', 'ChooseDesignTemplate', 'agent-2')
    emitArtifactWrittenAt('/work/src/a.json', 'ChooseDesignTemplate')
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ subtype: 'artifact_written', path: '/work/dc_artifacts/a/artifact.json', tool_name: 'ChooseDesignTemplate', agent_id: 'agent-2' })
  })
})
