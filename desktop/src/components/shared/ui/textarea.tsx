import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-ui-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-ui-muted-foreground focus-visible:border-ui-ring focus-visible:ring-3 focus-visible:ring-ui-ring/50 disabled:cursor-not-allowed disabled:bg-ui-input/50 disabled:opacity-50 aria-invalid:border-ui-destructive aria-invalid:ring-3 aria-invalid:ring-ui-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
