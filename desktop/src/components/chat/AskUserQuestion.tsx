import { useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Card, CardTitle, CardContent } from '../shared/ui/card'
import { Textarea } from '../shared/ui/textarea'
import { Button } from '../shared/ui/button'
import { Check, MessageCircleQuestion } from 'lucide-react'

type QuestionOption = {
  label: string
  description?: string
}

type Question = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

type AskUserInput = {
  questions?: Question[]
  question?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

type Props = {
  sessionId?: string | null
  toolUseId: string
  input: unknown
  result?: unknown
}

function parseInput(input: unknown): Question[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as AskUserInput

  if (Array.isArray(obj.questions)) {
    return obj.questions
  }

  if (typeof obj.question === 'string') {
    return [{
      question: obj.question,
      header: obj.header,
      options: obj.options,
      multiSelect: obj.multiSelect,
    }]
  }

  return []
}

type QuestionSelections = Record<number, string[]>
type QuestionFreeTexts = Record<number, string>

function getSelectedAnswer(question: Question, selected: string[] | undefined) {
  if (!selected || selected.length === 0) return ''
  return question.multiSelect ? selected.join(', ') : selected[0] ?? ''
}

export function AskUserQuestion({ sessionId, toolUseId, input, result }: Props) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const pendingRequestId = useChatStore((s) => {
    const pending = targetSessionId ? s.sessions[targetSessionId]?.pendingPermission : undefined
    return pending?.toolUseId === toolUseId ? pending.requestId : null
  })
  const t = useTranslation()
  const questions = parseInput(input)
  const inputObject = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const [activeTab, setActiveTab] = useState(0)
  const [selections, setSelections] = useState<QuestionSelections>({})
  const [freeTexts, setFreeTexts] = useState<QuestionFreeTexts>({})
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const composingRef = useRef(false)

  const safeActiveTab = Math.max(0, Math.min(activeTab, questions.length - 1))
  const activeQuestion = questions[safeActiveTab]

  const resultAnswers = useMemo(() => {
    if (!result || typeof result !== 'object') return {}
    const answers = (result as { answers?: unknown }).answers
    return answers && typeof answers === 'object'
      ? answers as Record<string, string>
      : {}
  }, [result])
  const resultText = typeof result === 'string' && result.trim().length > 0 ? result.trim() : ''
  const hasStructuredAnswers = Object.keys(resultAnswers).length > 0
  const hasTerminalResult = hasStructuredAnswers || resultText.length > 0

  const answeredText = useMemo(() => {
    if (hasStructuredAnswers) {
      return questions
        .map((question) => resultAnswers[question.question])
        .filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0)
        .join(', ')
    }
    if (resultText) return resultText
    return questions
      .map((question, index) => freeTexts[index]?.trim() || getSelectedAnswer(question, selections[index]))
      .filter(Boolean)
      .join('; ')
  }, [freeTexts, hasStructuredAnswers, questions, resultAnswers, resultText, selections])
  const submitted = hasTerminalResult || hasSubmitted
  const terminalWithoutAnswers = submitted && !hasStructuredAnswers && resultText.length > 0

  const handleSelect = (qIndex: number, label: string) => {
    if (submitted) return
    setSelections((prev) => {
      const question = questions[qIndex]
      const selected = prev[qIndex] ?? []
      if (question?.multiSelect) {
        const nextSelected = selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label]
        const next = { ...prev }
        if (nextSelected.length > 0) {
          next[qIndex] = nextSelected
        } else {
          delete next[qIndex]
        }
        return next
      }
      if (selected[0] === label) {
        const next = { ...prev }
        delete next[qIndex]
        return next
      }
      return { ...prev, [qIndex]: [label] }
    })
    setFreeTexts((prev) => {
      if (!prev[qIndex]) return prev
      const next = { ...prev }
      delete next[qIndex]
      return next
    })
  }

  const handleFreeTextChange = (qIndex: number, value: string) => {
    if (submitted) return
    setFreeTexts((prev) => {
      const next = { ...prev }
      if (value) {
        next[qIndex] = value
      } else {
        delete next[qIndex]
      }
      return next
    })
    if (value.trim()) {
      setSelections((prev) => {
        if (!prev[qIndex]) return prev
        const next = { ...prev }
        delete next[qIndex]
        return next
      })
    }
  }

  const handleSubmit = () => {
    if (submitted) return

    const parts: string[] = []
    for (let i = 0; i < questions.length; i++) {
      const answer = freeTexts[i]?.trim() || getSelectedAnswer(questions[i]!, selections[i])
      if (answer) parts.push(answer)
    }
    const response = parts.join('; ')
    if (!response) return

    if (!targetSessionId || !pendingRequestId) return

    const answers = questions.reduce<Record<string, string>>((acc, question, index) => {
      const freeText = freeTexts[index]?.trim()
      if (freeText) {
        acc[question.question] = freeText
      } else {
        const selected = getSelectedAnswer(question, selections[index])
        if (selected) acc[question.question] = selected
      }
      return acc
    }, {})

    setHasSubmitted(true)
    respondToPermission(targetSessionId, pendingRequestId, true, {
      updatedInput: {
        ...inputObject,
        answers,
      },
    })
  }

  const isAnswered = (index: number) =>
    Boolean(freeTexts[index]?.trim()) || (selections[index]?.length ?? 0) > 0
  const answeredCount = questions.filter((_, i) => isAnswered(i)).length
  const allAnswered = answeredCount === questions.length
  const isMultiQuestion = questions.length > 1

  if (!activeQuestion) return null

  const questionLabel = (question: Question, index: number) => question.header || `Q${index + 1}`

  if (submitted) {
    const answerFor = (question: Question, index: number) => {
      if (hasStructuredAnswers) return resultAnswers[question.question] ?? ''
      return freeTexts[index]?.trim() || getSelectedAnswer(question, selections[index])
    }
    return (
      <section
        data-testid="ask-user-question-answered"
        aria-label={t(terminalWithoutAnswers ? 'question.completed' : 'question.answered')}
        className="mb-4 border-y border-border py-3 text-sm"
      >
        <div className="flex items-center gap-2 text-xs text-subtle-foreground">
          <Check size={14} aria-hidden="true" className={terminalWithoutAnswers ? '' : 'text-success'} />
          <span className={terminalWithoutAnswers ? '' : 'text-success'}>
            {t(terminalWithoutAnswers ? 'question.completed' : 'question.answered')}
          </span>
          <span className="flex-1" />
          {isMultiQuestion && <span>{t('question.questionCount', { count: questions.length })}</span>}
        </div>

        {terminalWithoutAnswers ? (
          <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {t('question.resultPrefix')}{answeredText}
          </p>
        ) : (
          <dl className="mt-1">
            {questions.map((question, index) => (
              <div
                key={index}
                className="flex gap-4 border-b border-border py-1.5 text-sm last:border-b-0"
              >
                <dt className="min-w-[56px] shrink-0 text-subtle-foreground">{questionLabel(question, index)}</dt>
                <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{answerFor(question, index) || '—'}</dd>
              </div>
            ))}
          </dl>
        )}

        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-subtle-foreground hover:text-muted-foreground">
            {t('question.viewOriginal')}
          </summary>
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            {questions.map((question, index) => (
              <li key={index}>{question.question}</li>
            ))}
          </ul>
        </details>
      </section>
    )
  }

  const activeIsMultiSelect = activeQuestion.multiSelect === true
  const footHint = isMultiQuestion
    ? t('question.submitHint', { total: questions.length })
    : activeIsMultiSelect
      ? t('question.selectedCount', { count: selections[safeActiveTab]?.length ?? 0 })
      : ''

  return (
    <Card role="region" size="sm"
      data-testid="ask-user-question"
      aria-label={t('question.needsInput')}
      className="mb-4"
    >
      <div className="flex items-center gap-2 px-3 text-xs text-subtle-foreground">
        <MessageCircleQuestion size={14} aria-hidden="true" />
        <CardTitle>{t('question.needsInput')}</CardTitle>
        <span className="flex-1" />
        {isMultiQuestion ? (
          <span aria-live="polite">{t('question.progress', { answered: answeredCount, total: questions.length })}</span>
        ) : activeIsMultiSelect ? (
          <span>{t('question.multiSelectHint')}</span>
        ) : null}
      </div>
      <CardContent>
      {isMultiQuestion && (
        <nav aria-label={t('question.steps')} className="mt-3 flex flex-wrap gap-1.5">
          {questions.map((question, index) => {
            const current = safeActiveTab === index
            return (
              <button
                key={index}
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => setActiveTab(index)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  current
                    ? 'bg-selected text-foreground'
                    : 'text-muted-foreground hover:bg-hover'
                }`}
              >
                {isAnswered(index) && <Check size={12} aria-hidden="true" className="text-success" />}
                <span>{index + 1} · {questionLabel(question, index)}</span>
              </button>
            )
          })}
        </nav>
      )}

      <h3 className="mb-2 mt-3 text-sm font-medium leading-snug text-foreground">
        {activeQuestion.question}
        {isMultiQuestion && activeIsMultiSelect && (
          <span className="ml-2 text-xs font-normal text-subtle-foreground">{t('question.multiSelectHint')}</span>
        )}
      </h3>

      {activeQuestion.options && activeQuestion.options.length > 0 && (
        <div className="space-y-0.5" role="group" aria-label={activeQuestion.question}>
          {activeQuestion.options.map((opt, optIndex) => {
            const isSelected = selections[safeActiveTab]?.includes(opt.label) ?? false
            return (
              <Button variant="ghost" size="row"
                key={optIndex}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(safeActiveTab, opt.label)}
                className="items-start"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.75 flex h-[15px] w-[15px] shrink-0 items-center justify-center border transition-colors ${
                    activeIsMultiSelect ? 'rounded-sm' : 'rounded-full'
                  } ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-subtle-foreground'
                  }`}
                >
                  {isSelected && (activeIsMultiSelect
                    ? <Check size={11} strokeWidth={3} />
                    : <span className="h-[5px] w-[5px] rounded-full bg-primary-foreground" />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">{opt.label}</span>
                  {opt.description && (
                    <span className="mt-0.5 block text-xs text-subtle-foreground">{opt.description}</span>
                  )}
                </span>
              </Button>
            )
          })}
        </div>
      )}

      <label className="mt-3 block text-xs text-subtle-foreground">
        {t('question.customResponse')}
        <Textarea
          value={freeTexts[safeActiveTab] ?? ''}
          onChange={(e) => handleFreeTextChange(safeActiveTab, e.target.value)}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && allAnswered) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder={t('question.typePlaceholder')}
          rows={2}
          wrap="soft"
          className="mt-1.5 block max-h-48 min-h-[40px] w-full resize-y"
        />
      </label>

      </CardContent>
      <div className="flex flex-wrap items-center gap-2 px-3 text-xs text-subtle-foreground">
        <span className="min-w-0 flex-1">{footHint}</span>
        {isMultiQuestion && safeActiveTab > 0 && (
          <Button variant="ghost" size="xs" onClick={() => setActiveTab(safeActiveTab - 1)}>
            {t('question.prev')}
          </Button>
        )}
        {isMultiQuestion && safeActiveTab < questions.length - 1 && (
          <Button variant="ghost" size="xs" onClick={() => setActiveTab(safeActiveTab + 1)}>
            {t('question.next')}
          </Button>
        )}
        <Button
          size="xs"
          disabled={!allAnswered || !pendingRequestId}
          onClick={handleSubmit}
        >
          {t('question.submit')}
        </Button>
      </div>
    </Card>
  )
}
