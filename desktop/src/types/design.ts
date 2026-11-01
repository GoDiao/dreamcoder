export type DesignTemplateCategory = 'web' | 'prototype'

export type DesignText = { en: string; zh: string }

export type DesignTemplate = {
  id: string
  category: DesignTemplateCategory
  platform: 'desktop' | 'mobile' | null
  scenario: string | null
  entry: string
  acceptsDesignSystem: boolean
  title: DesignText
  description: DesignText
  tags: string[]
}

export type DesignTemplateCatalog = {
  version: 1
  templates: DesignTemplate[]
}

export type DesignArtifactResult = {
  id: string
  name: string
  artifactsDir: string
  dir: string
  filePath: string
  designSystem: string | null
}

export type DesignTemplatePreviewTarget = {
  rootDir: string
  filePath: string
}

export type DesignSystemLicense = { id: string; file: string | null; copyright: string }

export type DesignSystem = {
  id: string
  name: DesignText
  category: string
  description: DesignText
  origin: 'starter' | 'converted'
  swatches: string[]
  license: DesignSystemLicense
  author: string
}

export type DesignSystemCatalog = {
  version: 1
  systems: DesignSystem[]
}

export type DesignSystemInstallResult = {
  name: string
  dir: string
  artifactsDir: string
  reused: boolean
}
