import { useEffect, useRef, type ComponentProps } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import { installPageTextSelection } from "./text-selection";

export function TextSelectionScope(props: ComponentProps<"div">) {
  const t = useTranslator(messages);
  const root = useRef<HTMLDivElement>(null);
  useEffect(
    () => installPageTextSelection(root.current!, t("selection.textInput")),
    [t],
  );
  return <div {...props} ref={root} />;
}
