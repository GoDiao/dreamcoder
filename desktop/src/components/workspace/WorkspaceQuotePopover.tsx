import { useTranslation } from '../../i18n'
import { SelectionPopover, type SelectionPopoverQuote } from '../shared/SelectionPopover'
import type { WorkspaceQuoteSelection, WorkspaceTextSelection } from './workspaceSelection'

export function WorkspaceQuotePopover({ quote, onAddSelection }: {
  quote: SelectionPopoverQuote & { selection: WorkspaceQuoteSelection | null; dismiss: () => void }
  onAddSelection: (selection: WorkspaceTextSelection) => void
}) {
  const t = useTranslation()
  return (
    <SelectionPopover
      quote={quote}
      label={t('workspace.addSelectionToChat')}
      onAdd={() => {
        if (quote.selection) onAddSelection({ text: quote.selection.text, startLine: quote.selection.startLine, endLine: quote.selection.endLine })
        quote.dismiss()
      }}
    />
  )
}
