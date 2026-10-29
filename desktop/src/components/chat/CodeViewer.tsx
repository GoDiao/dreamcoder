import { useState } from 'react'
import { CopyButton } from '../shared/CopyButton'
import { Button } from '../shared/ui/button'
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockFooter, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from '../shared/ui/code-block'
import { useHighlightedCode } from '../../hooks/useHighlightedCode'
import { useTranslation } from '../../i18n'

type Props = {
  code: string
  language?: string
  maxLines?: number
  showLineNumbers?: boolean
}

export function CodeViewer({ code, language, maxLines = 20, showLineNumbers = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const allLines = code.split('\n')
  const isTruncated = !expanded && allLines.length > maxLines
  const visibleCode = isTruncated ? allLines.slice(0, maxLines).join('\n') : code
  const lines = useHighlightedCode(visibleCode, language || 'text')
  const effectiveShowLineNumbers = showLineNumbers && !!language && language !== 'text'
  const lineCountLabel = allLines.length === 1 ? t('codeViewer.oneLine') : t('codeViewer.lines', { count: allLines.length })

  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || t('codeViewer.code')}</CodeBlockTitle>
        <span>{lineCountLabel}</span>
        <CodeBlockActions><CopyButton text={code} /></CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        lineNumbers={effectiveShowLineNumbers}
        className="max-h-[420px]"
        aria-label={language || t('codeViewer.code')}
      >
        {lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)}
      </CodeBlockContent>
      {allLines.length > maxLines && (
        <CodeBlockFooter>
          <Button variant="ghost" size="xs" className="w-full" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('codeViewer.collapse') : t('codeViewer.showMore', { count: allLines.length - maxLines })}
          </Button>
        </CodeBlockFooter>
      )}
    </CodeBlock>
  )
}
