import { inkArchiveGroup } from "./ink-archive-group.mjs";
// ShowAI native geometry. Parent-local coordinates; no editor/DOM dependency.
export const radians = (degrees = 0) => (degrees * Math.PI) / 180;
export function rotatePoint(point, center, degrees = 0) {
  const a = radians(degrees),
    c = Math.cos(a),
    s = Math.sin(a);
  const x = point.x - center.x,
    y = point.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
}
export const frameHeight = (frame) =>
  frame.contentSize && Math.abs(frame.contentSize.width - frame.width) <= 0.5
    ? frame.contentSize.height
    : (frame.height ?? 0);
export function frameAnchor(frame, anchor) {
  const height = frameHeight(frame);
  return rotatePoint(
    { x: frame.x + frame.width * anchor.x, y: frame.y + height * anchor.y },
    { x: frame.x + frame.width / 2, y: frame.y + height / 2 },
    frame.rotation,
  );
}
export function normalizedAnchor(frame, point) {
  const height = frameHeight(frame);
  const p = rotatePoint(
    point,
    { x: frame.x + frame.width / 2, y: frame.y + height / 2 },
    -(frame.rotation ?? 0),
  );
  return {
    x: Math.max(0, Math.min(1, (p.x - frame.x) / frame.width)),
    y: height ? Math.max(0, Math.min(1, (p.y - frame.y) / height)) : 0.5,
  };
}
export function frameCorners(frame) {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ].map((anchor) => frameAnchor(frame, anchor));
}
export function pointsBounds(points) {
  if (!points.length) return null;
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { x, y, width: right - x, height: bottom - y };
}
export function frameBounds(frame) {
  return pointsBounds(frameCorners(frame));
}
export function hitFrame(frame, point, tolerance = 0) {
  const height = frameHeight(frame);
  const p = rotatePoint(
    point,
    { x: frame.x + frame.width / 2, y: frame.y + height / 2 },
    -(frame.rotation ?? 0),
  );
  return (
    p.x >= frame.x - tolerance &&
    p.x <= frame.x + frame.width + tolerance &&
    p.y >= frame.y - tolerance &&
    p.y <= frame.y + height + tolerance
  );
}
/** Separating-axis test avoids selecting empty corners of a rotated bounding box. */
export function intersectsFrame(frame, rect) {
  const a = frameCorners(frame),
    b = frameCorners(rect);
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < 2; i++)
    axes.push({ x: a[i + 1].y - a[i].y, y: a[i].x - a[i + 1].x });
  return axes.every((axis) => {
    const project = (p) => p.x * axis.x + p.y * axis.y;
    const pa = a.map(project),
      pb = b.map(project);
    return (
      Math.max(...pa) >= Math.min(...pb) && Math.max(...pb) >= Math.min(...pa)
    );
  });
}
export const screenToSurface = (point, origin, camera) => ({
  x: (point.x - origin.x - camera.x) / camera.scale,
  y: (point.y - origin.y - camera.y) / camera.scale,
});
export const surfaceToScreen = (point, origin, camera) => ({
  x: origin.x + camera.x + point.x * camera.scale,
  y: origin.y + camera.y + point.y * camera.scale,
});
export function objectCapabilities(node) {
  const drawing = node.type === "drawing",
    archiveGroup = !!inkArchiveGroup(node);
  const nativeInk =
    !!node.attrs?.nativeInk ||
    (node.type === "widget" &&
      node.attrs?.kind === "image" &&
      !!node.attrs?.data?.nativeInk);
  return {
    rotate:
      (drawing || nativeInk || archiveGroup || node.type === "image") &&
      !(drawing && node.attrs?.tool === "arrow"),
    resizeHeight:
      archiveGroup ||
      drawing ||
      nativeInk ||
      node.type === "image" ||
      (node.type === "surface" && node.attrs?.kind === "board"),
    bindTarget: !(drawing && node.attrs?.tool === "arrow"),
    minWidth: drawing || nativeInk || archiveGroup ? 1 : 120,
    minHeight: node.type === "surface" ? 180 : 1,
  };
}
/** Create once per gesture. Callers supply measured heights for content-sized nodes. */
export function createSnapIndex(objects) {
  const boxes = objects.map(({ id, frame }) => ({ id, ...frameBounds(frame) }));
  const anchors = (axis) =>
    boxes
      .flatMap((box) => {
        const size = axis === "x" ? box.width : box.height;
        return [0, 0.5, 1].map((part) => ({
          value: box[axis] + size * part,
          box,
        }));
      })
      .sort((a, b) => a.value - b.value || a.box.id.localeCompare(b.box.id));
  return { boxes, x: anchors("x"), y: anchors("y") };
}
function lowerBound(values, target) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid].value < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function snapFrame(frame, index, scale = 1, resize = false) {
  const box = frameBounds(frame),
    tolerance = 6 / Math.max(0.01, scale);
  const guides = [],
    delta = { x: 0, y: 0 };
  for (const axis of ["x", "y"]) {
    const size = axis === "x" ? "width" : "height",
      other = axis === "x" ? "y" : "x";
    const otherSize = axis === "x" ? "height" : "width";
    let best = tolerance + 1,
      selected;
    const consider = (distance, guide) => {
      if (Math.abs(distance) <= tolerance && Math.abs(distance) < best) {
        best = Math.abs(distance);
        delta[axis] = distance;
        selected = guide;
      }
    };
    for (const part of resize ? [1] : [0, 0.5, 1]) {
      const value = box[axis] + box[size] * part,
        entries = index[axis];
      for (
        let i = lowerBound(entries, value - tolerance);
        i < entries.length && entries[i].value <= value + tolerance;
        i++
      ) {
        const entry = entries[i];
        consider(entry.value - value, {
          axis,
          value: entry.value,
          from: Math.min(box[other], entry.box[other]),
          to: Math.max(
            box[other] + box[otherSize],
            entry.box[other] + entry.box[otherSize],
          ),
          kind: "align",
        });
      }
    }
    if (!resize) {
      // Only neighbors overlapping the object's orthogonal band can define an equal gap.
      const neighbors = index.boxes
        .filter(
          (b) =>
            b[other] < box[other] + box[otherSize] &&
            b[other] + b[otherSize] > box[other],
        )
        .sort((a, b) => a[axis] - b[axis]);
      for (let i = 0; i < neighbors.length - 1; i++) {
        const a = neighbors[i],
          b = neighbors[i + 1],
          gap = b[axis] - a[axis] - a[size];
        if (gap < 0) continue;
        for (const value of [
          a[axis] - gap - box[size],
          b[axis] + b[size] + gap,
          a[axis] + a[size] + (gap - box[size]) / 2,
        ]) {
          if (value > a[axis] && value < b[axis] && gap < box[size]) continue;
          consider(value - box[axis], {
            axis,
            value,
            from: Math.min(a[other], b[other], box[other]),
            to: Math.max(
              a[other] + a[otherSize],
              b[other] + b[otherSize],
              box[other] + box[otherSize],
            ),
            kind: "gap",
          });
        }
      }
    }
    if (selected) guides.push(selected);
  }
  return {
    frame: resize
      ? {
          ...frame,
          width: frame.width + delta.x,
          height: (frame.height ?? 0) + delta.y,
        }
      : { ...frame, x: frame.x + delta.x, y: frame.y + delta.y },
    guides,
  };
}

/** Resize in the object's local axes, preserving the opposite edge even when rotated. */
export function resizeFrame(
  frame,
  delta,
  handle = "se",
  minimum = { width: 1, height: 1 },
  keepAspect = false,
) {
  const local = rotatePoint(delta, { x: 0, y: 0 }, -(frame.rotation ?? 0));
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const oldHeight = frame.height ?? minimum.height;
  let width = Math.max(
    minimum.width,
    Math.min(10000, frame.width + local.x * sx),
  );
  let height = Math.max(
    minimum.height,
    Math.min(1000000, oldHeight + local.y * sy),
  );
  if (keepAspect && (sx || sy)) {
    const desired =
      sx && sy
        ? Math.max(width / frame.width, height / oldHeight)
        : sx
          ? width / frame.width
          : height / oldHeight;
    const ratio = Math.min(
      10000 / frame.width,
      1000000 / oldHeight,
      Math.max(
        desired,
        minimum.width / frame.width,
        minimum.height / oldHeight,
      ),
    );
    width = frame.width * ratio;
    height = oldHeight * ratio;
  }
  const shift = rotatePoint(
    { x: ((width - frame.width) * sx) / 2, y: ((height - oldHeight) * sy) / 2 },
    { x: 0, y: 0 },
    frame.rotation,
  );
  return {
    ...frame,
    x: frame.x + (frame.width - width) / 2 + shift.x,
    y: frame.y + (oldHeight - height) / 2 + shift.y,
    width,
    height,
  };
}

/** Snap the moving handle; fixed edges never attract their own stationary coordinate. */
export function snapResizeFrame(
  frame,
  index,
  scale,
  handle,
  minimum,
  keepAspect = false,
) {
  const horizontal = /[ew]/.test(handle),
    vertical = /[ns]/.test(handle);
  const anchor = {
    x: handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5,
    y: handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5,
  };
  const point = frameAnchor(frame, anchor),
    tolerance = 6 / Math.max(0.01, scale);
  const candidates = [];
  for (const axis of ["x", "y"]) {
    const entries = index[axis];
    for (
      let i = lowerBound(entries, point[axis] - tolerance);
      i < entries.length && entries[i].value <= point[axis] + tolerance;
      i++
    )
      candidates.push({
        axis,
        entry: entries[i],
        distance: entries[i].value - point[axis],
      });
  }
  let next = frame;
  if (horizontal && vertical && !keepAspect) {
    const delta = { x: 0, y: 0 };
    for (const axis of ["x", "y"]) {
      const best = candidates
        .filter((c) => c.axis === axis)
        .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))[0];
      if (best) delta[axis] = best.distance;
    }
    next = resizeFrame(frame, delta, handle, minimum);
  } else {
    const direction = keepAspect
      ? rotatePoint(
          {
            x: horizontal ? frame.width * (anchor.x === 0 ? -1 : 1) : 0,
            y: vertical ? (frame.height ?? 0) * (anchor.y === 0 ? -1 : 1) : 0,
          },
          { x: 0, y: 0 },
          frame.rotation,
        )
      : rotatePoint(
          horizontal
            ? { x: anchor.x === 0 ? -1 : 1, y: 0 }
            : { x: 0, y: anchor.y === 0 ? -1 : 1 },
          { x: 0, y: 0 },
          frame.rotation,
        );
    const viable = candidates
      .filter((c) => Math.abs(direction[c.axis]) > 1e-8)
      .map((c) => ({ ...c, amount: c.distance / direction[c.axis] }))
      .filter(
        (c) =>
          Math.hypot(direction.x * c.amount, direction.y * c.amount) <=
          tolerance,
      )
      .sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    if (viable[0])
      next = resizeFrame(
        frame,
        {
          x: direction.x * viable[0].amount,
          y: direction.y * viable[0].amount,
        },
        handle,
        minimum,
        keepAspect,
      );
  }
  const actual = frameAnchor(next, anchor),
    box = frameBounds(next),
    guides = [];
  for (const axis of ["x", "y"]) {
    const matched = candidates.find(
      (c) => c.axis === axis && Math.abs(c.entry.value - actual[axis]) < 0.001,
    );
    if (!matched) continue;
    // An unchanged orthogonal coordinate is not a resize snap.
    if (
      Math.abs(actual[axis] - point[axis]) < 0.001 &&
      !((axis === "x" && horizontal) || (axis === "y" && vertical))
    )
      continue;
    const other = axis === "x" ? "y" : "x",
      size = axis === "x" ? "height" : "width";
    guides.push({
      axis,
      value: matched.entry.value,
      from: Math.min(box[other], matched.entry.box[other]),
      to: Math.max(
        box[other] + box[size],
        matched.entry.box[other] + matched.entry.box[size],
      ),
      kind: "align",
    });
  }
  return { frame: next, guides };
}

/** Preserve relative geometry when the smallest member reaches its size limit. */
export function selectionMinimum(bounds, objects) {
  let widthRatio = 0,
    heightRatio = 0;
  for (const object of objects) {
    widthRatio = Math.max(widthRatio, object.minWidth / object.frame.width);
    if (object.resizeHeight)
      heightRatio = Math.max(
        heightRatio,
        object.minHeight / (object.frame.height || 1),
      );
  }
  return {
    width: Math.max(1, bounds.width * widthRatio),
    height: Math.max(1, (bounds.height || 1) * heightRatio),
  };
}

/** Bindings require a parent whose children have explicit local coordinates. */
export function bindingParent(parent, layout) {
  return (
    (parent?.type === "surface" && parent.attrs?.kind === "board") ||
    (parent?.type === "region" && layout?.[parent.attrs?.id]?.mode === "free")
  );
}

/** Clamp a selection as one translation, preserving member offsets at coordinate limits. */
export function translationDelta(frames, delta) {
  let minX = -Infinity,
    maxX = Infinity,
    minY = -Infinity,
    maxY = Infinity;
  for (const frame of frames) {
    minX = Math.max(minX, -1000000 - frame.x);
    maxX = Math.min(maxX, 1000000 - frame.x);
    minY = Math.max(minY, -1000000 - frame.y);
    maxY = Math.min(maxY, 1000000 - frame.y);
  }
  return {
    x: Math.max(minX, Math.min(maxX, delta.x)),
    y: Math.max(minY, Math.min(maxY, delta.y)),
  };
}
