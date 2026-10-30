import * as React from "react"
import { cn } from "@/lib/utils"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-ui-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:data-[state=unchecked]:border-ui-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ui-ring focus-visible:ring-3 focus-visible:ring-ui-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-ui-destructive aria-invalid:ring-3 aria-invalid:ring-ui-destructive/20 aria-invalid:aria-checked:border-ui-primary data-[state=checked]:border-ui-primary data-[state=checked]:bg-ui-primary data-[state=checked]:text-ui-primary-foreground group-has-[:focus-visible]/field-label:data-[state=checked]:border-ui-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
