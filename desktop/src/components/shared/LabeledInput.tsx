import { useId, type ComponentProps } from 'react'
import { Field, FieldError, FieldLabel } from './ui/field'
import { Input } from './ui/input'

type LabeledInputProps = Omit<ComponentProps<typeof Input>, 'required'> & {
  label?: string
  error?: string
  required?: boolean
  describedBy?: string
}

export function LabeledInput({ id, label, error, required, describedBy, ...inputProps }: LabeledInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const description = [describedBy, error && errorId].filter(Boolean).join(' ') || undefined
  return (
    <Field data-invalid={Boolean(error)}>
      {label && <FieldLabel htmlFor={inputId}>{label}{required && <span aria-hidden="true">*</span>}</FieldLabel>}
      <Input aria-invalid={error ? true : undefined} {...inputProps} id={inputId} required={required} aria-describedby={description} />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}
