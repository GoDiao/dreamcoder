import { Search } from 'lucide-react'
import type { ComponentProps } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'

type SearchFieldProps = Omit<ComponentProps<typeof InputGroupInput>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  variant?: ComponentProps<typeof InputGroup>['variant']
}

export function SearchField({ value, onChange, variant, className, ...props }: SearchFieldProps) {
  return (
    <InputGroup variant={variant} className={className}>
      <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput type="search" value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </InputGroup>
  )
}
