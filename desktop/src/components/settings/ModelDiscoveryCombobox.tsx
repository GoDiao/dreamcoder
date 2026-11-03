import { Command as CommandPrimitive } from 'cmdk'
import { Box, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProviderModel } from '../../types/provider'
import { Command, CommandItem, CommandList } from '../shared/ui/command'
import { Input } from '../shared/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '../shared/ui/popover'

type Props = {
  models: ProviderModel[]
  value: string
  onChange: (value: string) => void
  onSelect: (model: ProviderModel) => void
  label: string
  placeholder: string
  useCustomLabel: (id: string) => string
}

function ModelDiscoveryCombobox({
  models,
  value,
  onChange,
  onSelect,
  label,
  placeholder,
  useCustomLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const typed = value.trim()
  const query = typed.toLowerCase()
  const filteredModels = useMemo(() => {
    if (!query) return models
    const matches = models.filter((model) => (
      model.id.toLowerCase().includes(query) || model.name?.toLowerCase().includes(query)
    ))
    return [...matches.filter((model) => model.id === typed), ...matches.filter((model) => model.id !== typed)]
  }, [models, query, typed])
  const offerTyped = typed !== '' && !models.some((model) => model.id === typed)
  const expanded = open && models.length > 0

  useEffect(() => {
    if (models.length === 0) setOpen(false)
  }, [models.length])

  const selectModel = (model: ProviderModel) => {
    onSelect(model)
    setOpen(false)
  }

  return (
    <Command label={label} shouldFilter={false} className="block size-auto overflow-visible rounded-none! bg-transparent p-0">
      <Popover open={expanded} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <CommandPrimitive.Input
              asChild
              value={value}
              onValueChange={(next) => {
                onChange(next)
                if (models.length > 0) setOpen(true)
              }}
            >
              <Input
                autoComplete="off"
                onFocus={() => {
                  if (models.length > 0) setOpen(true)
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && models.length > 0) setOpen(true)
                }}
                placeholder={placeholder}
                className="pr-8"
              />
            </CommandPrimitive.Input>
            {models.length > 0 && (
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('[cmdk-root]')) event.preventDefault()
          }}
          onMouseDown={(event) => event.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          <CommandList aria-label={label} className="max-h-[240px]">
            {offerTyped && (
              <CommandItem value={`custom-model:${typed}`} onSelect={() => setOpen(false)} className="gap-2 px-3 py-2">
                <Plus aria-hidden="true" className="text-[var(--color-text-secondary)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">{useCustomLabel(typed)}</span>
              </CommandItem>
            )}
            {filteredModels.map((model) => (
              <CommandItem
                key={model.id}
                value={model.id}
                data-checked={model.id === value}
                onSelect={() => selectModel(model)}
                className="gap-2 px-3 py-2"
              >
                <Box aria-hidden="true" className="text-[var(--color-text-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{model.name || model.id}</span>
                  {model.name && <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{model.id}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  )
}

export { ModelDiscoveryCombobox }
