import { api, getBaseUrl } from './client'
import type { ArtifactCopyResult, ArtifactListItem, ArtifactOpenTarget } from '../types/artifact'

type ArtifactUserWrite = { dir: string; files: string[]; latestMtimeMs: number }

export const artifactsApi = {
  list: () => api.get<{ artifacts: ArtifactListItem[] }>('/api/artifacts'),

  open: (dir: string, name: string, board?: string) => {
    const query = new URLSearchParams({ dir, name, ...(board && { board }) })
    return api.get<ArtifactOpenTarget>(`/api/artifacts/open?${query.toString()}`)
  },

  putThumbnail: (id: string, mtimeMs: number, data: string) => api.put<{ ok: true }>('/api/artifacts/thumbnail', { id, mtimeMs, data }),

  moveBoard: (body: { dir: string; name: string; boardId: string; x: number; y: number; width: number; height: number }) =>
    api.patch<ArtifactUserWrite>('/api/artifacts/boards', body),

  holdEdit: (dir: string, name: string, holder: string) => api.post<{ ok: true }>('/api/artifacts/edit-lock', { dir, name, holder }),

  releaseEdit: (dir: string, name: string, holder: string) => api.delete<{ ok: true }>(`/api/artifacts/edit-lock?${new URLSearchParams({ dir, name, holder }).toString()}`),

  reorderSlides: (body: { dir: string; name: string; slides: string[] }) => api.patch<ArtifactUserWrite>('/api/artifacts/slides/order', body),

  deleteSlide: (dir: string, name: string, id: string) => api.delete<ArtifactUserWrite>(`/api/artifacts/slides?${new URLSearchParams({ dir, name, id }).toString()}`),

  writeSlide: (body: { dir: string; name: string; id: string; html: string; previous: string }) => api.put<ArtifactUserWrite>('/api/artifacts/slides/content', body),

  markOpened: (id: string) => api.post<{ ok: true }>('/api/artifacts/opened', { id }),

  copyInto: (id: string, sessionId: string) => api.post<ArtifactCopyResult>('/api/artifacts/copy', { id, sessionId }),

  openById: (id: string) => {
    const query = new URLSearchParams({ id })
    return api.get<ArtifactOpenTarget>(`/api/artifacts/open?${query.toString()}`)
  },
}

export function artifactThumbnailUrl(id: string, version: number) {
  return `${getBaseUrl()}/api/artifacts/thumbnail?${new URLSearchParams({ id, v: String(version) }).toString()}`
}
