import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import { NativeInkPreview } from "../../surface/NativeInkPreview";
import { safeImageUrl } from "../blocks/helpers";
import { richTextStyle } from "./model.mjs";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/media";
import commonMessages from "../../i18n/messages/common";
import "../blocks/research-media.css";

/**
 * Shown instead of an image that failed to load or whose address is not
 * allowed, following the media block's failure notice: what happened, and
 * the original address to open or copy.
 */
function ImageUnavailable({
  src,
  blocked,
}: {
  src: string;
  blocked: boolean;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const [copy, setCopy] = useState<"" | "copied" | "failed">("");
  return (
    <div className="sb-image-unavailable" role="img" aria-label={src}>
      <p>{blocked ? t("imageBlocked") : t("imageFailed")}</p>
      <span className="sb-image-unavailable-actions">
        {!blocked && (
          <a href={src} target="_blank" rel="noopener noreferrer">
            {t("openAddress")}
          </a>
        )}
        <button
          type="button"
          title={src}
          onClick={() =>
            navigator.clipboard.writeText(src).then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            )
          }
        >
          {copy === "copied"
            ? tc("copied")
            : copy === "failed"
              ? t("copyAddressFailed")
              : t("copyAddress")}
        </button>
      </span>
    </div>
  );
}

/** Image content has one presentation in editable documents, SDK blocks and exports. */
export function ImageContent({
  attrs,
}: {
  attrs: NonNullable<JSONContent["attrs"]>;
}) {
  const [failed, setFailed] = useState("");
  const src = attrs.src ? safeImageUrl(attrs.src) : undefined;
  return (
    <figure className="sb-image" style={richTextStyle(attrs.componentStyle)}>
      {attrs.nativeInk ? (
        <NativeInkPreview ink={attrs.nativeInk} />
      ) : attrs.src && (!src || failed === src) ? (
        <ImageUnavailable src={String(attrs.src)} blocked={!src} />
      ) : src ? (
        <img
          className="document-image portable-image"
          src={src}
          alt={attrs.alt ?? ""}
          title={attrs.title}
          onError={() => setFailed(src)}
          style={{
            width: attrs.width ?? undefined,
            height: attrs.height ?? "auto",
            borderRadius: attrs.componentStyle?.radius,
            ...(attrs.align === "left"
              ? { marginLeft: 0, marginRight: "auto" }
              : attrs.align === "right"
                ? { marginLeft: "auto", marginRight: 0 }
                : {}),
            objectFit: attrs.fit === "cover" ? "cover" : "contain",
          }}
        />
      ) : (
        <div className="sb-image-empty">{attrs.alt || "🖼"}</div>
      )}
      {attrs.caption && <figcaption>{attrs.caption}</figcaption>}
    </figure>
  );
}
