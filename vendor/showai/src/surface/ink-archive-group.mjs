import { inkFramePose } from "./portable-ink.mjs";
/** A lossless container for independently editable strokes from one native archive.
 * Its extent is the children's coordinate space; the outer frame can scale/rotate
 * without rewriting any child samples or their original archive provenance. */
export function inkArchiveGroup(node) {
  return node?.type === "region" ? (node.attrs?.inkArchiveGroup ?? null) : null;
}
export function validateInkArchiveGroup(node) {
  const value = node?.attrs?.inkArchiveGroup;
  if (value === undefined) return null;
  if (
    node.type !== "region" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new Error("inkArchiveGroup requires a region.");
  if (
    Object.keys(value).some(
      (key) => !["version", "extent", "sourceDrawing"].includes(key),
    ) ||
    value.version !== 1
  )
    throw new Error("Unsupported inkArchiveGroup contract.");
  if (
    !Array.isArray(value.extent) ||
    value.extent.length !== 2 ||
    value.extent.some(
      (n) =>
        typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 1000000,
    )
  )
    throw new Error(
      "inkArchiveGroup.extent requires two finite dimensions between 1 and 1000000.",
    );
  const prefix = "data:application/vnd.showai.pencilkit;base64,";
  if (
    typeof value.sourceDrawing !== "string" ||
    !value.sourceDrawing.startsWith(prefix) ||
    value.sourceDrawing.length <= prefix.length ||
    value.sourceDrawing.length > 90000000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.sourceDrawing.slice(prefix.length))
  )
    throw new Error(
      "inkArchiveGroup.sourceDrawing requires the original PencilKit archive.",
    );
  if (
    node.attrs.ink !== undefined ||
    node.attrs.nativeInk !== undefined ||
    node.content?.some(
      (child) =>
        child.type !== "drawing" ||
        child.attrs?.ink?.format !== "showai-ink-v1",
    )
  )
    throw new Error(
      "inkArchiveGroup contains editable drawing children and has no ink of its own.",
    );
  return value;
}
export function inkArchiveGroupLayout(group, frame) {
  if (
    !group ||
    !frame ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    !(frame.width > 0) ||
    !(frame.height > 0)
  )
    throw new Error("inkArchiveGroup requires a finite frame.");
  return {
    width: group.extent[0],
    height: group.extent[1],
    scaleX: frame.width / group.extent[0],
    scaleY: frame.height / group.extent[1],
  };
}

/** Bake the child frame into its portable affine when removing this container.
 * Keeping the outer group frame also represents nonuniform scale plus child
 * rotation (which cannot be represented by a single rotated rectangle). */
export function flattenInkArchiveChild(node, localFrame, group, outerFrame) {
  const pose = inkFramePose(localFrame, node.attrs.extent),
    result = structuredClone(node);
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  for (const ink of [result.attrs.ink, ...(result.attrs.inkFragments ?? [])]) {
    ink.transform = multiply(pose, ink.transform);
    ink.extent = [...group.extent];
  }
  result.attrs.extent = [...group.extent];
  const frame = {
    x: outerFrame.x,
    y: outerFrame.y,
    width: outerFrame.width,
    height: outerFrame.height,
  };
  if (outerFrame.rotation !== undefined) frame.rotation = outerFrame.rotation;
  if (localFrame.locked || outerFrame.locked) frame.locked = true;
  return { node: result, frame };
}
