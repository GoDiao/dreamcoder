declare const MACRO: {
  VERSION: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  VERSION_CHANGELOG: string
  ISSUES_EXPLAINER: string
}

declare module '*.md' {
  const text: string
  export default text
}

declare module 'bidi-js' {
  type EmbeddingLevelsResult = {
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }

  export default function bidiFactory(): {
    getEmbeddingLevels(
      text: string,
      baseDirection?: 'ltr' | 'rtl' | 'auto',
    ): EmbeddingLevelsResult
  }
}
