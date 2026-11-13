import * as React from "react"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

type TabsVariant = "default" | "line"

const TabsVariantContext = React.createContext<TabsVariant>("default")

const tabsListVariants = cva(
  "group/tabs-list inline-flex items-center text-muted-foreground group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:items-stretch",
  {
    variants: {
      variant: {
        default: "w-fit gap-1",
        line: "w-full gap-5 border-b border-border",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

const tabsTriggerVariants = cva(
  "inline-flex min-w-0 shrink-0 items-center justify-center gap-1 whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground group-data-[orientation=vertical]/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "h-6 rounded-md px-2 text-xs hover:bg-hover data-[state=active]:bg-selected",
        line: "relative h-9 rounded-sm px-0.5 text-sm after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 data-[state=active]:after:opacity-100",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const resolved = variant ?? "default"
  return (
    <TabsVariantContext.Provider value={resolved}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={resolved}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsClosableTrigger({
  className,
  icon,
  closeLabel,
  onClose,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  icon: React.ReactNode
  closeLabel: string
  onClose: () => void
}) {
  return (
    <div
      data-slot="tabs-closable"
      className={cn(
        "group/tab relative inline-flex h-6 min-w-0 shrink-0 items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground has-data-[state=active]:bg-selected has-data-[state=active]:text-foreground",
        className
      )}
    >
      <TabsPrimitive.Trigger
        data-slot="tabs-trigger"
        className="inline-flex h-full min-w-0 items-center gap-1 rounded-md pr-2 pl-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
        {...props}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center group-focus-within/tab:invisible group-hover/tab:invisible pointer-coarse:invisible">{icon}</span>
        <span className="min-w-0 truncate">{children}</span>
      </TabsPrimitive.Trigger>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute top-1/2 left-1.5 flex size-3.5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 hover:bg-selected hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5"
      >
        <XIcon className="size-3" aria-hidden="true" />
      </button>
    </div>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsClosableTrigger, TabsContent }
