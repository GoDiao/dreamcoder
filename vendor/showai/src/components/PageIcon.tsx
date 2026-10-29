import { useState, type ReactNode } from "react";
import { FileText } from "../ui/icons";
import { isImageIcon } from "../lib/page-icon.mjs";

export default function PageIcon({
  value = "",
  size = 18,
  fallback,
}: {
  value?: string;
  size?: number;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = isImageIcon(value);
  return (
    <span
      className="page-icon"
      style={{
        display: "inline-flex",
        flexShrink: 0,
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        fontSize: size,
        lineHeight: 1,
        overflow: "hidden",
        verticalAlign: "middle",
      }}
      aria-hidden="true"
    >
      {image && failed !== value ? (
        <img
          src={value}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(value)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: 3,
          }}
        />
      ) : value && !image ? (
        value
      ) : (
        (fallback ?? <FileText size={size} />)
      )}
    </span>
  );
}
