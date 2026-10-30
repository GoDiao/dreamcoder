import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform,opacity] outline-none select-none focus-visible:border-ui-ring focus-visible:ring-3 focus-visible:ring-ui-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-ui-destructive aria-invalid:ring-3 aria-invalid:ring-ui-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-ui-primary text-ui-primary-foreground hover:bg-ui-primary/80",
        outline:
          "border-ui-border bg-ui-background hover:bg-ui-muted hover:text-ui-foreground aria-expanded:bg-ui-muted aria-expanded:text-ui-foreground",
        secondary:
          "bg-ui-secondary text-ui-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-ui-secondary aria-expanded:text-ui-secondary-foreground",
        ghost:
          "hover:bg-ui-muted hover:text-ui-foreground aria-expanded:bg-ui-muted aria-expanded:text-ui-foreground",
        destructive:
          "bg-ui-destructive/10 text-ui-destructive hover:bg-ui-destructive/20 focus-visible:border-ui-destructive/40 focus-visible:ring-ui-destructive/20",
        gradient:
          "bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105",
        link: "text-ui-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-sm px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-sm in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        "icon-xl": "size-11",
        row: "h-auto w-full min-w-0 justify-start gap-2.5 px-2.5 py-2 text-left font-normal whitespace-normal",
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
