import type { CSSProperties, Ref } from "react";
import { useDelayedFlag } from "./delayed-flag";
import "./pending.css";

/**
 * A calm placeholder for content that is still loading. It keeps the space
 * the content is expected to need from the start, and only shows its line
 * and skeleton after a short delay so fast loads never flash.
 *
 * `overlay` is placed just before a frame whose size is already reserved and
 * covers its first `minHeight` pixels while the frame starts; otherwise the
 * notice takes its place in the flow.
 */
export function PendingNotice({
  label,
  active = true,
  minHeight,
  lines = 0,
  overlay = false,
  className = "",
  style,
  ...rest
}: {
  label: string;
  active?: boolean;
  minHeight?: number;
  /** Skeleton bars shown under the line, approximating the content to come. */
  lines?: number;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-preview-pending"?: "true";
  ref?: Ref<HTMLDivElement>;
}) {
  const visible = useDelayedFlag(active);
  if (!active) return null;
  const notice = (
    <div
      {...rest}
      className={`showai-pending${overlay ? " is-overlay" : ""}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      style={
        minHeight
          ? { [overlay ? "height" : "minHeight"]: minHeight, ...style }
          : style
      }
    >
      {visible && (
        <>
          <span className="showai-pending-label">{label}</span>
          {Array.from({ length: lines }, (_, index) => (
            <span key={index} className="showai-pending-bar" aria-hidden="true" />
          ))}
        </>
      )}
    </div>
  );
  // Placed just before the frame it covers; takes no space of its own.
  return overlay ? <div className="showai-pending-anchor">{notice}</div> : notice;
}
