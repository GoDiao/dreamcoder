import * as React from "react"
import { cn } from "@/lib/utils"

function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
