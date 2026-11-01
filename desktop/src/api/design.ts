import { api } from './client'
import type {
  DesignArtifactResult,
  DesignSystemCatalog,
  DesignSystemInstallResult,
  DesignTemplateCatalog,
  DesignTemplatePreviewTarget,
} from '../types/design'

export const designApi = {
  templates: () => api.get<DesignTemplateCatalog>('/api/design/templates'),

  systemCatalog: () => api.get<DesignSystemCatalog>('/api/design/systems/catalog'),

  preview: (templateId: string) =>
    api.get<DesignTemplatePreviewTarget>(`/api/design/templates/${encodeURIComponent(templateId)}/preview`),

  createArtifact: (body: { project: string; templateId: string; name?: string; title?: string; designSystemId?: string }) =>
    api.post<DesignArtifactResult>('/api/design/artifacts', body),

  installSystem: (sessionId: string, systemId: string) =>
    api.post<DesignSystemInstallResult>(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/artifacts/systems`, { systemId }),
}

export function designTemplateThumbnailUrl(templateId: string) {
  return `/design-templates/${encodeURIComponent(templateId)}.jpg`
}
