import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale,opacity] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:not-disabled:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/25 inset-shadow-highlight hover:bg-primary/90 active:inset-shadow-none disabled:shadow-none",
        outline:
          "border-input bg-popover text-foreground shadow-xs shadow-black/5 hover:bg-hover aria-expanded:bg-selected dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary/80",
        ghost:
          "text-foreground hover:bg-hover data-highlighted:bg-hover aria-expanded:bg-selected aria-pressed:bg-selected aria-[current]:bg-selected",
        "ghost-muted":
          "text-muted-foreground hover:bg-hover hover:text-foreground data-highlighted:bg-hover data-highlighted:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground aria-[current]:bg-selected aria-[current]:text-foreground",
        "ghost-destructive":
          "text-muted-foreground hover:bg-destructive/10 hover:text-destructive aria-expanded:bg-destructive/10 aria-expanded:text-destructive",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
        "link-muted": "font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 px-2.5 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        toolbar: "h-7 gap-1.5 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-9",
        "icon-xl": "size-11",
        "icon-pill": "size-8 rounded-full",
        "icon-xl-pill": "size-11 rounded-full",
        row: "h-auto min-h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal whitespace-normal",
        "row-sm": "h-auto min-h-7 w-full min-w-0 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-normal whitespace-normal [&_svg:not([class*='size-'])]:size-3.5",
        "row-lg": "h-auto min-h-11 w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal",
        "row-flush": "h-auto min-h-11 w-full min-w-0 justify-start gap-3 rounded-none border-x-0 border-t-0 border-b-border px-0 py-2.5 text-left font-normal whitespace-normal",
        inline: "h-auto gap-1 border-0 p-0",
        "inline-text": "h-auto min-w-0 justify-start gap-1 border-0 p-0 text-left text-[length:inherit]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({ variant, size, className }),
        loading && !asChild && "[&>[data-icon=inline-start]:not([data-slot=spinner])]:hidden"
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? children : (
        <>
          {loading && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
