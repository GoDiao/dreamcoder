import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "@/i18n"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useTranslation()
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true"
  const accessibility = decorative ? {} : { role: "status", "aria-label": t("common.loading") }
  return (
    <Loader2Icon data-slot="spinner" {...accessibility} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
