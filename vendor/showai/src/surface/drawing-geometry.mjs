import {
  frameHeight,
  frameBounds,
  frameAnchor,
  snapResizeFrame,
  hitFrame,
  intersectsFrame,
  pointsBounds,
  rotatePoint,
} from "./geometry.mjs";
import { polygonContains } from "./lasso.mjs";
import {
  isPortableInk,
  portableNodeHit,
  portableNodeBounds,
  portableInkGeometry,
} from "./portable-ink.mjs";

/** A lasso selects enclosed paint and any contour touched by its trace. */
export function shapeIntersectsPolygon(node, frame, polygon, tolerance = 0) {
  if (polygon.length < 2) return false;
  if(node.type==="drawing"&&node.attrs?.ink?.format==="showai-ink-v2")return cubicIntersectsPolygon(node,frame,polygon,tolerance);
  const center = {
    x: frame.x + frame.width / 2,
    y: frame.y + frameHeight(frame) / 2,
  };
  const drawing = node.type === "drawing";
  const vertices = drawing
    ? drawingOutline(node, frame).vertices.map((p) =>
        rotatePoint(
          { x: p.x + frame.x, y: p.y + frame.y },
          center,
          frame.rotation,
        ),
      )
    : [
        { x: 0, y: 0 },
        { x: frame.width, y: 0 },
        { x: frame.width, y: frameHeight(frame) },
        { x: 0, y: frameHeight(frame) },
        { x: 0, y: 0 },
      ].map((p) =>
        rotatePoint(
          { x: p.x + frame.x, y: p.y + frame.y },
          center,
          frame.rotation,
        ),
      );
  const radius =
    tolerance +
    (drawing
      ? ((node.attrs.strokeWidth ?? 0) *
          Math.max(
            frame.width / node.attrs.extent[0],
            frameHeight(frame) / node.attrs.extent[1],
          )) /
        2
      : 0);
  if (polygon.length >= 3 && vertices.some((p) => polygonContains(polygon, p)))
    return true;
  if (
    polygon.some((p) => {
      const hit = shapeHit(node, frame, p);
      return hit.distance <= radius || (hit.inside && hit.solid);
    })
  )
    return true;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const intersects = (a, b, c, d) => {
    const c1 = cross(a, b, c),
      c2 = cross(a, b, d),
      c3 = cross(c, d, a),
      c4 = cross(c, d, b);
    if (
      ((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) &&
      ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))
    )
      return true;
    return (
      Math.min(
        segmentDistance(a, c, d),
        segmentDistance(b, c, d),
        segmentDistance(c, a, b),
        segmentDistance(d, a, b),
      ) <= radius
    );
  };
  return vertices.some(
    (b, i) =>
      i > 0 &&
      polygon.some((d, j) =>
        intersects(
          vertices[i - 1],
          b,
          polygon[(j + polygon.length - 1) % polygon.length],
          d,
        ),
      ),
  );
}
function cubicIntersectsPolygon(node,frame,polygon,tolerance){
  const center={x:frame.x+frame.width/2,y:frame.y+frameHeight(frame)/2},[w,h]=node.attrs.extent;
  const contours=portableInkGeometry(node.attrs.ink,node.attrs.strokeWidth,node.attrs.pressure).polygons.map(points=>points.map(p=>rotatePoint({x:frame.x+p.x*frame.width/w,y:frame.y+p.y*frameHeight(frame)/h},center,frame.rotation)));
  if(polygon.length>=3&&contours.some(points=>points.some(p=>polygonContains(polygon,p))))return true;
  if(polygon.some(p=>{const hit=shapeHit(node,frame,p);return hit.inside||hit.distance<=tolerance;}))return true;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const intersects=(a,b,c,d)=>{const u=cross(a,b,c),v=cross(a,b,d),p=cross(c,d,a),q=cross(c,d,b);return (((u>0&&v<0)||(u<0&&v>0))&&((p>0&&q<0)||(p<0&&q>0)))||Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b))<=tolerance;};
  return contours.some(points=>points.some((b,i)=>polygon.some((d,j)=>intersects(points[(i+points.length-1)%points.length],b,polygon[(j+polygon.length-1)%polygon.length],d))));
}

/** Geometry is the painted centerline, independent of SVG viewport padding. */
export function drawingBounds(node) {
  if (node.type !== "drawing") return null;
  if (isPortableInk(node.attrs.ink))
    return portableNodeBounds(node);
  if (node.attrs.ink)
    return {
      x: 0,
      y: 0,
      width: node.attrs.extent[0],
      height: node.attrs.extent[1],
    };
  const { points, tool } = node.attrs;
  if (tool !== "arrow") return pointsBounds(points);
  const a = points[0],
    b = points.at(-1),
    angle = Math.atan2(b.y - a.y, b.x - a.x),
    head = arrowHeadLength(a, b, node.attrs.strokeWidth);
  return pointsBounds([
    ...points,
    ...[-0.5, 0.5].map((turn) => ({
      x: b.x - head * Math.cos(angle + turn),
      y: b.y - head * Math.sin(angle + turn),
    })),
  ]);
}

export function geometryFrame(node, frame) {
  const box = drawingBounds(node);
  if (!box) return frame;
  const [w, h] = node.attrs.extent;
  const width = Math.max(1, (box.width * frame.width) / w);
  const height = Math.max(1, (box.height * frameHeight(frame)) / h);
  const center = rotatePoint(
    {
      x: frame.x + ((box.x + box.width / 2) * frame.width) / w,
      y: frame.y + ((box.y + box.height / 2) * frameHeight(frame)) / h,
    },
    { x: frame.x + frame.width / 2, y: frame.y + frameHeight(frame) / 2 },
    frame.rotation,
  );
  return {
    ...frame,
    contentSize: undefined,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

/** Convert an edited geometry back to the unchanged document's SVG coordinates. */
export function frameFromGeometry(node, stored, visual) {
  const box = drawingBounds(node);
  if (!box) return visual;
  const original = geometryFrame(node, stored),
    width = (stored.width * visual.width) / original.width,
    height =
      (frameHeight(stored) * frameHeight(visual)) / frameHeight(original),
    [w, h] = node.attrs.extent;
  const offset = rotatePoint(
    {
      x: ((box.x + box.width / 2) / w - 0.5) * width,
      y: ((box.y + box.height / 2) / h - 0.5) * height,
    },
    { x: 0, y: 0 },
    visual.rotation,
  );
  return {
    ...stored,
    x: visual.x + visual.width / 2 - offset.x - width / 2,
    y: visual.y + frameHeight(visual) / 2 - offset.y - height / 2,
    width,
    height,
    ...(visual.rotation === undefined ? {} : { rotation: visual.rotation }),
  };
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

function drawingOutline(node, frame, p = { x: Infinity, y: Infinity }) {
  const height = frameHeight(frame);
  const { points, extent, tool } = node.attrs;
  const local = points.map((q) => ({
    x: (q.x * frame.width) / extent[0],
    y: (q.y * height) / extent[1],
  }));
  const box = pointsBounds(local),
    a = local[0],
    b = local.at(-1);
  let vertices = local,
    inside = false;
  if (
    tool === "rectangle" ||
    (node.attrs.ink && !isPortableInk(node.attrs.ink))
  ) {
    vertices = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
      { x: box.x, y: box.y },
    ];
    inside =
      p.x >= box.x &&
      p.x <= box.x + box.width &&
      p.y >= box.y &&
      p.y <= box.y + box.height;
  } else if (tool === "ellipse") {
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2,
      rx = box.width / 2,
      ry = box.height / 2;
    inside =
      rx > 0 && ry > 0 && ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
    vertices = Array.from({ length: 97 }, (_, i) => ({
      x: cx + rx * Math.cos((i * Math.PI) / 48),
      y: cy + ry * Math.sin((i * Math.PI) / 48),
    }));
  } else if (tool === "arrow") {
    // Arrowheads use the same SVG-local dimensions as Drawing.
    const first = points[0],
      last = points.at(-1),
      angle = Math.atan2(last.y - first.y, last.x - first.x);
    const head = arrowHeadLength(first, last, node.attrs.strokeWidth);
    const tip = (sign) => ({
      x:
        ((last.x - head * Math.cos(angle + sign * 0.5)) * frame.width) /
        extent[0],
      y: ((last.y - head * Math.sin(angle + sign * 0.5)) * height) / extent[1],
    });
    vertices = [a, b, tip(-1), b, tip(1)];
  }
  return { vertices, inside, box };
}

function ellipseDistance(point, box) {
  let a = box.width / 2,
    b = box.height / 2;
  let x = Math.abs(point.x - box.x - a),
    y = Math.abs(point.y - box.y - b);
  if (a < b) {
    [a, b] = [b, a];
    [x, y] = [y, x];
  }
  if (!a || !b)
    return segmentDistance(
      point,
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    );
  if (!y) {
    const delta = a * a - b * b;
    if (delta > 0 && a * x < delta) {
      const cosine = (a * x) / delta;
      return Math.hypot(a * cosine - x, b * Math.sqrt(1 - cosine * cosine));
    }
    return Math.abs(x - a);
  }
  let low = b * y - b * b,
    high = Math.max(0, a * x + b * y);
  for (let i = 0; i < 64; i++) {
    const t = (low + high) / 2;
    if (((a * x) / (t + a * a)) ** 2 + ((b * y) / (t + b * b)) ** 2 > 1)
      low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return Math.hypot(
    (a * a * x) / (t + a * a) - x,
    (b * b * y) / (t + b * b) - y,
  );
}

export function shapeHit(node, frame, point) {
  if (node.type !== "drawing") {
    const p = rotatePoint(
      point,
      { x: frame.x + frame.width / 2, y: frame.y + frameHeight(frame) / 2 },
      -(frame.rotation ?? 0),
    );
    const inside = hitFrame(frame, point);
    // A free region is a frame around other objects: only its border is
    // solid, so objects overlapped by its empty interior stay reachable.
    const hollow = node.type === "region" && frame.mode === "free";
    return {
      inside,
      distance:
        hollow && inside
          ? Math.min(
              p.x - frame.x,
              frame.x + frame.width - p.x,
              p.y - frame.y,
              frame.y + frameHeight(frame) - p.y,
            )
          : Math.hypot(
              Math.max(frame.x - p.x, 0, p.x - frame.x - frame.width),
              Math.max(frame.y - p.y, 0, p.y - frame.y - frameHeight(frame)),
            ),
      solid: !hollow,
      area: frame.width * frameHeight(frame),
    };
  }
  const height = frameHeight(frame),
    p = rotatePoint(
      point,
      { x: frame.x + frame.width / 2, y: frame.y + height / 2 },
      -(frame.rotation ?? 0),
    );
  p.x -= frame.x;
  p.y -= frame.y;
  if (isPortableInk(node.attrs.ink)) {
    const result = portableNodeHit(
      node,
      {
        x: (p.x * node.attrs.extent[0]) / frame.width,
        y: (p.y * node.attrs.extent[1]) / height,
      },
    );
    return {
      ...result,
      distance:
        result.distance *
        Math.min(
          frame.width / node.attrs.extent[0],
          height / node.attrs.extent[1],
        ),
    };
  }
  const { vertices, inside, box } = drawingOutline(node, frame, p);
  const a = vertices[0];
  let distance =
    vertices.length === 1 ? Math.hypot(p.x - a.x, p.y - a.y) : Infinity;
  for (let i = 1; i < vertices.length; i++)
    distance = Math.min(
      distance,
      segmentDistance(p, vertices[i - 1], vertices[i]),
    );
  if (node.attrs.tool === "ellipse") distance = ellipseDistance(p, box);
  return {
    distance,
    inside,
    solid:
      !!node.attrs.ink ||
      ((node.attrs.tool === "rectangle" || node.attrs.tool === "ellipse") &&
        !!node.attrs.fillColor &&
        node.attrs.fillColor !== "none"),
    area: box.width * box.height,
  };
}

/** Brush the visible paths, not the empty area enclosed by a hollow drawing. */
export function shapeIntersects(node, frame, rect, wrap = false) {
  const bounds = frameBounds(geometryFrame(node, frame));
  const contains =
    rect.x <= bounds.x &&
    rect.y <= bounds.y &&
    rect.x + rect.width >= bounds.x + bounds.width &&
    rect.y + rect.height >= bounds.y + bounds.height;
  if (contains) return true;
  if (wrap || node.type === "surface" || node.type === "region") return false;
  if (!intersectsFrame(geometryFrame(node, frame), rect)) return false;
  if (node.attrs?.ink && !isPortableInk(node.attrs.ink)) return true;
  if (node.type !== "drawing") return true;
  if(node.attrs?.ink?.format==="showai-ink-v2")return cubicIntersectsPolygon(node,frame,[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}],0);
  if (
    node.attrs.fillColor &&
    node.attrs.fillColor !== "none" &&
    ["rectangle", "ellipse"].includes(node.attrs.tool)
  ) {
    if (
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].some(
        ([x, y]) =>
          shapeHit(node, frame, {
            x: rect.x + x * rect.width,
            y: rect.y + y * rect.height,
          }).inside,
      )
    )
      return true;
  }
  const center = {
    x: frame.x + frame.width / 2,
    y: frame.y + frameHeight(frame) / 2,
  };
  if (node.attrs.tool === "ellipse") {
    const box = drawingOutline(node, frame).box,
      rx = box.width / 2,
      ry = box.height / 2;
    if (rx > 0 && ry > 0) {
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y]) => {
        const p = rotatePoint(
          { x: rect.x + rect.width * x, y: rect.y + rect.height * y },
          center,
          -(frame.rotation ?? 0),
        );
        return {
          x: (p.x - frame.x - box.x - rx) / rx,
          y: (p.y - frame.y - box.y - ry) / ry,
        };
      });
      return corners.some((a, i) => {
        const b = corners[(i + 1) % 4],
          dx = b.x - a.x,
          dy = b.y - a.y,
          A = dx * dx + dy * dy,
          B = 2 * (a.x * dx + a.y * dy),
          C = a.x * a.x + a.y * a.y - 1;
        if (!A) return Math.abs(C) < 1e-10;
        const discriminant = B * B - 4 * A * C;
        return (
          discriminant >= 0 &&
          [-1, 1].some((sign) => {
            const t = (-B + sign * Math.sqrt(discriminant)) / (2 * A);
            return t >= 0 && t <= 1;
          })
        );
      });
    }
  }
  const vertices = drawingOutline(node, frame).vertices.map((p) =>
    rotatePoint({ x: p.x + frame.x, y: p.y + frame.y }, center, frame.rotation),
  );
  const crosses = (a, b) => {
    let low = 0,
      high = 1;
    for (const [axis, size] of [
      ["x", "width"],
      ["y", "height"],
    ]) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-10) {
        if (a[axis] < rect[axis] || a[axis] > rect[axis] + rect[size])
          return false;
      } else {
        const t0 = (rect[axis] - a[axis]) / delta,
          t1 = (rect[axis] + rect[size] - a[axis]) / delta;
        low = Math.max(low, Math.min(t0, t1));
        high = Math.min(high, Math.max(t0, t1));
        if (low > high) return false;
      }
    }
    return true;
  };
  return vertices.some((point, i) =>
    crosses(point, vertices[Math.max(0, i - 1)]),
  );
}

/** Candidates are in paint order. Empty interiors never occlude closer geometry. */
export function pickShape(candidates, hitInside = true) {
  return pickCandidate(candidates, hitInside, false);
}

/** Selection owns the whole drawing frame; painting and erasing keep path hits. */
export function pickSelection(candidates) {
  return pickCandidate(candidates, true, true);
}

function pickCandidate(candidates, hitInside, drawingBounds) {
  let edge = null,
    hollow = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const item = candidates[i];
    if (
      !hitFrame(
        geometryFrame(item.node, item.frame),
        item.point,
        item.tolerance,
      )
    )
      continue;
    const hit = shapeHit(item.node, item.frame, item.point);
    if (hit.solid && hit.inside) return edge?.item ?? item;
    if (hit.distance <= item.tolerance) {
      if (!edge || hit.distance * item.scale < edge.distance - 1e-6)
        edge = { item, distance: hit.distance * item.scale };
    } else if (
      hitInside &&
      (hit.inside || (drawingBounds && item.node.type === "drawing")) &&
      ((drawingBounds && item.node.type === "drawing") ||
        !item.viewport ||
        ![
          ...[
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ].every(([x, y]) =>
          hitFrame(geometryFrame(item.node, item.frame), {
            x: item.viewport.x + item.viewport.width * x,
            y: item.viewport.y + item.viewport.height * y,
          }),
        )) &&
      (!hollow || hit.area * item.scale ** 2 < hollow.area)
    )
      hollow = { item, area: hit.area * item.scale ** 2 };
  }
  return edge?.item ?? hollow?.item ?? null;
}

/** Arrowheads grow with the stroke so thick arrows keep a visible head. */
export function arrowHeadLength(a, b, strokeWidth = 2.5) {
  return Math.min(
    Math.max(20, strokeWidth * 4),
    Math.hypot(b.x - a.x, b.y - a.y) * 0.3,
  );
}
export function arrowPath(a, b, strokeWidth = 2.5) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x),
    head = arrowHeadLength(a, b, strokeWidth);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${b.x - head * Math.cos(angle - 0.5)} ${b.y - head * Math.sin(angle - 0.5)} L ${b.x} ${b.y} L ${b.x - head * Math.cos(angle + 0.5)} ${b.y - head * Math.sin(angle + 0.5)}`;
}

/** Freehand strokes render through segment midpoints as smooth quadratic curves. */
export function smoothPath(points) {
  if (points.length < 3)
    return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      q = points[i + 1];
    path += ` Q ${p.x} ${p.y} ${(p.x + q.x) / 2} ${(p.y + q.y) / 2}`;
  }
  const last = points.at(-1);
  return `${path} L ${last.x} ${last.y}`;
}

/** Creation modifiers match the geometry later used for selection and snapping. */
export function creationPoints(
  tool,
  origin,
  current,
  { shiftKey = false, altKey = false } = {},
) {
  let dx = current.x - origin.x,
    dy = current.y - origin.y;
  if (shiftKey && tool === "arrow") {
    const length = Math.hypot(dx, dy),
      angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI) / 12;
    dx = length * Math.cos(angle);
    dy = length * Math.sin(angle);
  } else if (shiftKey && (tool === "rectangle" || tool === "ellipse")) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  return [
    { x: origin.x - (altKey ? dx : 0), y: origin.y - (altKey ? dy : 0) },
    { x: origin.x + dx, y: origin.y + dy },
  ];
}

export function snapCreation(points, index, scale, keepAspect = false) {
  const bounds = pointsBounds(points),
    a = points[0],
    b = points.at(-1);
  const handle = `${b.y < a.y ? "n" : "s"}${b.x < a.x ? "w" : "e"}`;
  const result = snapResizeFrame(
    {
      ...bounds,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    },
    index,
    scale,
    handle,
    { width: 1, height: 1 },
    keepAspect,
  );
  return {
    points: [
      a,
      frameAnchor(result.frame, {
        x: handle.includes("e") ? 1 : 0,
        y: handle.includes("s") ? 1 : 0,
      }),
    ],
    guides: result.guides,
  };
}
