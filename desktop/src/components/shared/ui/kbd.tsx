import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-ui-muted px-1 font-sans text-xs font-medium text-ui-muted-foreground select-none in-data-[slot=tooltip-content]:bg-ui-background/20 in-data-[slot=tooltip-content]:text-ui-background [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
