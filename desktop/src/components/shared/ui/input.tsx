import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-ui-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ui-foreground placeholder:text-ui-muted-foreground focus-visible:border-ui-ring focus-visible:ring-3 focus-visible:ring-ui-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-ui-input/50 disabled:opacity-50 aria-invalid:border-ui-destructive aria-invalid:ring-3 aria-invalid:ring-ui-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
