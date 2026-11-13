import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full px-2.5 py-2 text-sm rounded-lg border border-input bg-popover shadow-xs shadow-black/5 transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-subtle-foreground hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
