import * as React from "react"
import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
} from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import { bundledLanguages, type BundledLanguage } from "shiki/langs"

let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })

  return highlighter
}

function getLanguage(language: string) {
  const name = language.toLowerCase()

  if (name === "ansi") {
    return name
  }

  if (Object.hasOwn(bundledLanguages, name)) {
    return name as BundledLanguage
  }

  return null
}
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language)

  if (!lang) {
    return null
  }

  const shiki = await getHighlighter()

  if (lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(bundledLanguages[lang])
  }

  return {
    highlight(code: string, state?: GrammarState): { lines: React.ReactNode[]; state?: GrammarState } {
      try {
        const tokenize = (text: string) =>
          shiki.codeToTokens(text, {
            lang,
            themes: { light: "github-light", dark: "github-dark" },
            defaultColor: false,
            grammarState: state,
          }).tokens
        const tokens =
          lang === "ansi"
            ? code.split("\n").flatMap((line) => tokenize(line))
            : tokenize(code)

        return {
          lines: tokens.map((line) =>
            line.map((token, index) => (
              <span
                key={index}
                style={token.htmlStyle as React.CSSProperties}
                className="code-syntax-token"
              >
                {token.content}
              </span>
            ))
          ),
          state: lang === "ansi" ? undefined : shiki.getLastGrammarState(tokens),
        }
      } catch (error) {
        console.error("[CodeHighlight] Failed to highlight language:", lang, error)
        return { lines: code.split("\n") }
      }
    },
  }
}
