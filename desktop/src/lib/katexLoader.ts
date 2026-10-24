import type Katex from 'katex'

type KatexModule = typeof Katex

let loadedKatex: KatexModule | null = null
let katexPromise: Promise<KatexModule> | null = null

export function getLoadedKatex(): KatexModule | null {
  return loadedKatex
}

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
      katexPromise = null
      throw err
    },
  )
  return katexPromise
}
