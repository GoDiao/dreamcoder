import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('./client', () => ({ api: { get: mocks.get, post: mocks.post } }))

import { designApi, designTemplateThumbnailUrl } from './design'

describe('designApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the catalog and a template preview, encoding the id', () => {
    designApi.templates()
    designApi.preview('a/b c')
    expect(mocks.get).toHaveBeenNthCalledWith(1, '/api/design/templates')
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/api/design/templates/a%2Fb%20c/preview')
  })

  it('creates an artifact from a template', () => {
    designApi.createArtifact({ project: '/repo', templateId: 'saas', title: 'Landing' })
    expect(mocks.post).toHaveBeenCalledWith('/api/design/artifacts', { project: '/repo', templateId: 'saas', title: 'Landing' })
  })

  it('points the thumbnail at the static file bundled with the app', () => {
    expect(designTemplateThumbnailUrl('saas')).toBe('/design-templates/saas.jpg')
  })
})
