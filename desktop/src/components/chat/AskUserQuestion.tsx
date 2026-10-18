import { useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
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
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const pendingPermission = useChatStore((s) => targetSessionId ? s.sessions[targetSessionId]?.pendingPermission : undefined)
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

  const pendingRequest = pendingPermission?.toolUseId === toolUseId ? pendingPermission : null
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

    if (!targetSessionId || !pendingRequest) return

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
    respondToPermission(targetSessionId, pendingRequest.requestId, true, {
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
        className="mb-4 border-y border-[var(--color-border)] py-3 text-ui-body"
      >
        <div className="flex items-center gap-2 text-ui-aux text-[var(--color-text-tertiary)]">
          <Check size={14} aria-hidden="true" className={terminalWithoutAnswers ? '' : 'text-[var(--color-success)]'} />
          <span className={terminalWithoutAnswers ? '' : 'text-[var(--color-success)]'}>
            {t(terminalWithoutAnswers ? 'question.completed' : 'question.answered')}
          </span>
          <span className="flex-1" />
          {isMultiQuestion && <span>{t('question.questionCount', { count: questions.length })}</span>}
        </div>

        {terminalWithoutAnswers ? (
          <p className="mt-2 text-ui-body text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
            {t('question.resultPrefix')}{answeredText}
          </p>
        ) : (
          <dl className="mt-1">
            {questions.map((question, index) => (
              <div
                key={index}
                className="flex gap-4 border-b border-[var(--color-border)] py-1.5 text-[13px] last:border-b-0"
              >
                <dt className="min-w-[56px] shrink-0 text-[var(--color-text-tertiary)]">{questionLabel(question, index)}</dt>
                <dd className="min-w-0 text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{answerFor(question, index) || '—'}</dd>
              </div>
            ))}
          </dl>
        )}

        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            {t('question.viewOriginal')}
          </summary>
          <ul className="mt-1.5 space-y-1 text-[var(--color-text-secondary)]">
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
    <section
      data-testid="ask-user-question"
      aria-label={t('question.needsInput')}
      className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3.5"
    >
      <div className="flex items-center gap-2 text-ui-aux text-[var(--color-text-tertiary)]">
        <MessageCircleQuestion size={14} aria-hidden="true" />
        <span>{t('question.needsInput')}</span>
        <span className="flex-1" />
        {isMultiQuestion ? (
          <span aria-live="polite">{t('question.progress', { answered: answeredCount, total: questions.length })}</span>
        ) : activeIsMultiSelect ? (
          <span>{t('question.multiSelectHint')}</span>
        ) : null}
      </div>

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
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-aux transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                  current
                    ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {isAnswered(index) && <Check size={12} aria-hidden="true" className="text-[var(--color-success)]" />}
                <span>{index + 1} · {questionLabel(question, index)}</span>
              </button>
            )
          })}
        </nav>
      )}

      <h3 className="mb-2 mt-3 text-[15px] font-medium leading-snug text-[var(--color-text-primary)]">
        {activeQuestion.question}
        {isMultiQuestion && activeIsMultiSelect && (
          <span className="ml-2 text-ui-aux font-normal text-[var(--color-text-tertiary)]">{t('question.multiSelectHint')}</span>
        )}
      </h3>

      {activeQuestion.options && activeQuestion.options.length > 0 && (
        <div className="space-y-0.5" role="group" aria-label={activeQuestion.question}>
          {activeQuestion.options.map((opt, optIndex) => {
            const isSelected = selections[safeActiveTab]?.includes(opt.label) ?? false
            return (
              <button
                key={optIndex}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(safeActiveTab, opt.label)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                  isSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-[3px] flex h-[15px] w-[15px] shrink-0 items-center justify-center border transition-colors ${
                    activeIsMultiSelect ? 'rounded-[4px]' : 'rounded-full'
                  } ${
                    isSelected
                      ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-surface)]'
                      : 'border-[var(--color-outline)]'
                  }`}
                >
                  {isSelected && (activeIsMultiSelect
                    ? <Check size={11} strokeWidth={3} />
                    : <span className="h-[5px] w-[5px] rounded-full bg-[var(--color-surface)]" />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-body text-[var(--color-text-primary)]">{opt.label}</span>
                  {opt.description && (
                    <span className="mt-0.5 block text-ui-aux text-[var(--color-text-tertiary)]">{opt.description}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <label className="mt-3 block text-ui-aux text-[var(--color-text-tertiary)]">
        {t('question.customResponse')}
        <textarea
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
          className="mt-1.5 block max-h-48 min-h-[40px] w-full resize-y rounded-lg border border-[var(--color-border)] bg-transparent px-2.5 py-2 text-ui-body leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-ui-aux text-[var(--color-text-tertiary)]">
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
          variant="primary"
          size="xs"
          disabled={!allAnswered || !pendingRequest}
          onClick={handleSubmit}
        >
          {t('question.submit')}
        </Button>
      </div>
    </section>
  )
}
