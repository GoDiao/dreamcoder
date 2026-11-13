import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 px-2.5 text-sm file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
  {
    variants: {
      variant: {
        default: "rounded-lg border border-input bg-popover shadow-xs shadow-black/5 transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-subtle-foreground hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30",
        ghost: "rounded-lg border border-transparent bg-transparent transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-subtle-foreground hover:bg-hover focus-visible:border-ring focus-visible:bg-popover focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
      },
      size: {
        default: "h-8",
        sm: "h-7",
      },
      font: {
        sans: "",
        mono: "font-mono text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      font: "sans",
    },
  }
)

function Input({
  className,
  type,
  variant,
  size,
  font,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant ?? "default"}
      className={cn(inputVariants({ variant, size, font }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
