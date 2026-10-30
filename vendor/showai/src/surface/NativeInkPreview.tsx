import "./native-ink.css";
import {useContext} from "react";
import {ObjectContext} from "./object-context";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/nativeInk";
export function NativeInkPreview({
  ink,
}: {
  ink: { extent: [number, number]; preview: string; darkPreview?: string };
}) {
  const t = useTranslator(messages),nativeScene=useContext(ObjectContext).nativeScene;
  const [width, height] = ink.extent;
  return (
    <svg
      className="board-drawing native-ink-preview"
      data-native-ink
      data-native-measurement={nativeScene?"true":undefined}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("ink")}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      {!nativeScene&&<image
        className={ink.darkPreview ? "board-ink-light" : undefined}
        href={ink.preview}
        width={width}
        height={height}
        preserveAspectRatio="none"
      />}
      {!nativeScene&&ink.darkPreview && (
        <image
          className="board-ink-dark"
          href={ink.darkPreview}
          width={width}
          height={height}
          preserveAspectRatio="none"
        />
      )}
    </svg>
  );
}
