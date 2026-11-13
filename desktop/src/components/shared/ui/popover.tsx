import * as React from "react"
import { cn } from "@/lib/utils"
import { pointerAwareCloseAutoFocus } from "@/lib/pointerModality"
import { Popover as PopoverPrimitive } from "radix-ui"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  onCloseAutoFocus,
  size = "default",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & { size?: "default" | "flush" }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        data-size={size}
        onCloseAutoFocus={pointerAwareCloseAutoFocus(onCloseAutoFocus)}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 overflow-hidden rounded-lg bg-popover p-2.5 text-sm data-[size=flush]:gap-0 data-[size=flush]:p-0 text-popover-foreground shadow-popover ring-1 ring-foreground/10 outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
