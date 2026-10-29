import { useId } from "react";
import {
  portableInkGeometry,
  portableInkColor,
  type PortableInk,
} from "./portable-ink.mjs";

/** Shared brush output; the SVG is editable geometry, never a raster preview. */
export function PortableInkPaths({
  ink,
  fragments = [],
  color,
  width,
  pressure,
}: {
  ink: PortableInk;
  fragments?: PortableInk[];
  color: string;
  width?: number;
  pressure?: boolean;
}) {
  const id = useId(),
    parts = [ink, ...fragments].map((value) => ({
      ink: value, geometry: portableInkGeometry(value, width, pressure),
    })),
    hasMasks = parts.some(({geometry}) => !!geometry.mask);
  return (
    <>
      {hasMasks && (
        <defs>
          {parts.map(({ink: part, geometry}, index) => geometry.mask && <clipPath key={index} id={`${id}-${index}`} clipPathUnits="userSpaceOnUse">
            <path
              d={geometry.mask}
              transform={`matrix(${part.transform.join(" ")})`}
            />
          </clipPath>)}
        </defs>
      )}
      {[false, true].map((dark) => (
        <g
          key={String(dark)}
          className={dark ? "board-ink-dark" : "board-ink-light"}
          opacity={ink.opacity}
        >
          {hasMasks ? parts.map(({geometry}, index) => <path key={index}
            data-portable-ink={ink.format==="showai-ink-v2"?"2":"1"} d={geometry.path} fill={portableInkColor(color, dark)} stroke="none"
            clipPath={geometry.mask ? `url(#${id}-${index})` : undefined} />)
            : <path data-portable-ink={ink.format==="showai-ink-v2"?"2":"1"} d={parts.map(({geometry}) => geometry.path).join(" ")}
                fill={portableInkColor(color, dark)} stroke="none" />}
        </g>
      ))}
    </>
  );
}
