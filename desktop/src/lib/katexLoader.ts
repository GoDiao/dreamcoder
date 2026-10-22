import type Katex from 'katex'

type KatexModule = typeof Katex

let loadedKatex: KatexModule | null = null
let katexPromise: Promise<KatexModule> | null = null

/** KaTeX once it has been loaded, so cached renders can stay synchronous. */
export function getLoadedKatex(): KatexModule | null {
  return loadedKatex
}

/**
 * Loads KaTeX and its stylesheet on first use. Most replies contain no math, so
 * neither belongs in the startup bundle.
 */
export function loadKatex(): Promise<KatexModule> {
  katexPromise ??= Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
  ]).then(
    ([{ default: katex }]) => {
      loadedKatex = katex
      return katex
    },
    (err: unknown) => {
      // Let a later formula retry instead of caching a failed chunk load forever.
      katexPromise = null
      throw err
    },
  )
  return katexPromise
}
