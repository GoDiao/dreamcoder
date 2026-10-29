import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import {
  AxesHelper,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  type Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BlockProps } from "./types";
import {
  boundValue,
  sceneLabels,
  validateScene3dData,
  type Scene3dBinding,
  type Scene3dData,
  type Scene3dObject,
  type Scene3dParameter,
} from "./scene3d-contract.mjs";
import { BlockHeader, blockLabel } from "./shared";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import { Play, RotateCcw, Square } from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/scene3d";
import "./scene3d.css";
import {
  isNumberRecord,
  useReaderState,
  useResetOnChange,
} from "../../surface/reader-state";

// Objects without a color take one from this palette, chosen to read on light and dark grounds.
const PALETTE = [
  "#4f7cac",
  "#d1784c",
  "#5a9a78",
  "#b85c7c",
  "#8a6fbf",
  "#c9a227",
];
const DEMO_MS = 2400;

type Inherited = { color?: string; opacity?: number; wireframe?: boolean };
type Bound = {
  object: Object3D;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  bindings: Scene3dBinding[];
};
// `lift` raises a label along world up, so labels stay above rotated shapes.
type Anchor = { object: Object3D; local: Vector3; lift: number };
type Built = { root: Group; bound: Bound[]; anchors: Anchor[] };
type Engine = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  content?: Built;
  helpers: Object3D[];
  visible: boolean;
  frame: number;
  baseFov: number;
  invalidate: () => void;
};

const vector = (value: number[] | undefined, fallback = 0) =>
  new Vector3(
    value?.[0] ?? fallback,
    value?.[1] ?? fallback,
    value?.[2] ?? fallback,
  );

function scaleVector(scale: Scene3dObject["scale"]) {
  return typeof scale === "number"
    ? new Vector3(scale, scale, scale)
    : vector(scale, 1);
}

function material(object: Scene3dObject, inherited: Inherited, index: number) {
  const opacity = object.opacity ?? inherited.opacity ?? 1;
  return new MeshStandardMaterial({
    color: object.color ?? inherited.color ?? PALETTE[index % PALETTE.length],
    roughness: 0.55,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
    wireframe: object.wireframe ?? inherited.wireframe ?? false,
    side: object.type === "plane" ? DoubleSide : FrontSide,
  });
}

function geometry(object: Scene3dObject) {
  switch (object.type) {
    case "box": {
      const [x, y, z] = object.size ?? [1, 1, 1];
      return new BoxGeometry(x, y, z);
    }
    case "plane": {
      const [x, y] = object.size ?? [1, 1];
      return new PlaneGeometry(x, y);
    }
    case "sphere":
      return new SphereGeometry(object.radius ?? 0.5, 40, 24);
    case "cylinder":
      return new CylinderGeometry(
        object.radiusTop ?? object.radius ?? 0.5,
        object.radiusBottom ?? object.radius ?? 0.5,
        object.height ?? 1,
        40,
      );
    case "cone":
      return new ConeGeometry(object.radius ?? 0.5, object.height ?? 1, 40);
    case "torus":
      return new TorusGeometry(
        object.radius ?? 0.5,
        object.tube ?? 0.15,
        24,
        72,
      );
  }
  return undefined;
}

/** Builds the declared objects; anchors follow the order of sceneLabels(). */
function buildScene(data: Scene3dData): Built {
  const root = new Group();
  const bound: Bound[] = [];
  const anchors: Anchor[] = [];
  let index = 0;
  const add = (
    object: Scene3dObject,
    parent: Object3D,
    inherited: Inherited,
  ) => {
    const colorIndex = index++;
    const node = new Group();
    node.position.copy(vector(object.position));
    const rotation = vector(object.rotation);
    node.rotation.set(
      MathUtils.degToRad(rotation.x),
      MathUtils.degToRad(rotation.y),
      MathUtils.degToRad(rotation.z),
      object.rotationOrder ?? "XYZ",
    );
    node.scale.copy(scaleVector(object.scale));
    parent.add(node);
    if (object.bindings?.length)
      bound.push({
        object: node,
        position: node.position.clone(),
        rotation,
        scale: node.scale.clone(),
        bindings: object.bindings,
      });

    const color = object.color ?? inherited.color;
    let labelAt = new Vector3();
    let lift = 0;
    const shape = geometry(object);
    if (shape) {
      node.add(new Mesh(shape, material(object, inherited, colorIndex)));
      shape.computeBoundingSphere();
      // Mesh labels sit just above the shape so they do not cover it.
      const sphere = shape.boundingSphere!;
      labelAt = sphere.center.clone();
      lift =
        sphere.radius * Math.max(node.scale.x, node.scale.y, node.scale.z) +
        0.15;
    } else if (object.type === "arrow") {
      const from = vector(object.from),
        to = vector(object.to);
      const direction = to.clone().sub(from);
      const length = direction.length();
      direction.normalize();
      // A solid shaft and head stay visible at any zoom, unlike 1px lines.
      const radius = Math.min(Math.max(length * 0.01, 0.015), 0.06);
      const head = Math.min(radius * 8, length * 0.3);
      const arrow = new Group();
      arrow.position.copy(from);
      arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
      const arrowMaterial = () =>
        material({ ...object, type: "cone" }, inherited, colorIndex);
      const shaft = new Mesh(
        new CylinderGeometry(radius, radius, length - head, 16),
        arrowMaterial(),
      );
      shaft.position.y = (length - head) / 2;
      const tip = new Mesh(
        new ConeGeometry(radius * 3, head, 24),
        arrowMaterial(),
      );
      tip.position.y = length - head / 2;
      arrow.add(shaft, tip);
      node.add(arrow);
      labelAt = to
        .clone()
        .addScaledVector(direction, Math.max(0.2, length * 0.05));
    } else if (object.type === "line") {
      const points = object.points!.map((point) => vector(point));
      const Kind = object.closed ? LineLoop : Line;
      node.add(
        new Kind(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({
            color: color ?? PALETTE[colorIndex % PALETTE.length],
            transparent: (object.opacity ?? inherited.opacity ?? 1) < 1,
            opacity: object.opacity ?? inherited.opacity ?? 1,
          }),
        ),
      );
      labelAt = points[points.length - 1];
    }
    const label =
      object.type === "label" ? (object.text ?? object.label) : object.label;
    if (label)
      anchors.push({
        object: node,
        local: object.labelOffset ? vector(object.labelOffset) : labelAt,
        lift: object.labelOffset ? 0 : lift,
      });
    const next: Inherited = {
      color,
      opacity: object.opacity ?? inherited.opacity,
      wireframe: object.wireframe ?? inherited.wireframe,
    };
    object.children?.forEach((child) => add(child, node, next));
  };
  data.objects.forEach((object) => add(object, root, {}));
  return { root, bound, anchors };
}

function applyBindings(built: Built, values: Record<string, number>) {
  for (const item of built.bound) {
    const position = item.position.clone(),
      rotation = item.rotation.clone(),
      scale = item.scale.clone();
    for (const binding of item.bindings) {
      const [target, axis] = binding.property.split(".") as [
        "position" | "rotation" | "scale",
        "x" | "y" | "z" | undefined,
      ];
      const vectorFor = { position, rotation, scale }[target];
      for (const key of axis ? [axis] : (["x", "y", "z"] as const))
        vectorFor[key] = boundValue(vectorFor[key], binding, values);
    }
    item.object.position.copy(position);
    item.object.rotation.set(
      MathUtils.degToRad(rotation.x),
      MathUtils.degToRad(rotation.y),
      MathUtils.degToRad(rotation.z),
    );
    // Avoid a degenerate matrix when a binding drives scale through zero.
    item.object.scale.set(
      Math.abs(scale.x) < 1e-4 ? 1e-4 : scale.x,
      Math.abs(scale.y) < 1e-4 ? 1e-4 : scale.y,
      Math.abs(scale.z) < 1e-4 ? 1e-4 : scale.z,
    );
  }
}

function disposeTree(object: Object3D) {
  object.traverse((child) => {
    const owner = child as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    owner.geometry?.dispose();
    (Array.isArray(owner.material) ? owner.material : [owner.material]).forEach(
      (item) => item?.dispose(),
    );
  });
}

/** Resolves a CSS custom property to a color Three.js can parse. */
function cssColor(element: Element, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (!value) return fallback;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  return context.fillStyle;
}

// Narrow stages widen the vertical field of view so the horizontal framing holds.
const FRAME_ASPECT = 1.6;
function fitFieldOfView(engine: Engine) {
  const { camera, baseFov } = engine;
  camera.fov =
    camera.aspect >= FRAME_ASPECT
      ? baseFov
      : Math.min(
          100,
          MathUtils.radToDeg(
            2 *
              Math.atan(
                (Math.tan(MathUtils.degToRad(baseFov) / 2) * FRAME_ASPECT) /
                  camera.aspect,
              ),
          ),
        );
  camera.updateProjectionMatrix();
}

function placeCamera(engine: Engine, data: Scene3dData) {
  const { camera, controls } = engine;
  engine.baseFov = data.camera?.fov ?? 45;
  fitFieldOfView(engine);
  const bounds = engine.content
    ? new Box3().setFromObject(engine.content.root)
    : new Box3();
  const sphere = bounds.isEmpty()
    ? new Sphere(new Vector3(), 1)
    : bounds.getBoundingSphere(new Sphere());
  const target = data.camera?.target
    ? vector(data.camera.target)
    : sphere.center.clone();
  const radius = Math.max(sphere.radius, 0.5);
  const position = data.camera?.position
    ? vector(data.camera.position)
    : target
        .clone()
        .add(
          new Vector3(1, 0.65, 1.25)
            .normalize()
            .multiplyScalar(
              (radius / Math.sin(MathUtils.degToRad(engine.baseFov / 2))) *
                1.05,
            ),
        );
  camera.position.copy(position);
  const distance = position.distanceTo(target);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 50 + radius * 10;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = distance * 0.15;
  controls.maxDistance = distance * 8;
  controls.update();
}

const initialValues = (parameters: Scene3dParameter[]) =>
  Object.fromEntries(parameters.map((item) => [item.id, item.value]));
const formatValue = (value: number, step = 1) =>
  value.toFixed(Math.min(4, Math.max(0, -Math.floor(Math.log10(step)))));

/** Smoothly sweeps start → max → min → start. */
function demoValue(
  parameter: Scene3dParameter,
  start: number,
  progress: number,
) {
  const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
  const legs: [number, number][] = [
    [start, parameter.max],
    [parameter.max, parameter.min],
    [parameter.min, start],
  ];
  const lengths = legs.map(([from, to]) => Math.abs(to - from) || 1e-9);
  const total = lengths.reduce((sum, item) => sum + item, 0);
  let at = progress * total;
  for (let leg = 0; leg < legs.length; leg++) {
    if (at <= lengths[leg] || leg === legs.length - 1) {
      const [from, to] = legs[leg];
      return from + (to - from) * ease(Math.min(1, at / lengths[leg]));
    }
    at -= lengths[leg];
  }
  return start;
}

export function Scene3DBlock({ data: raw }: BlockProps) {
  const t = useTranslator(messages);
  const instanceId = useId();
  const data = validateScene3dData(raw);
  const parameters = data.parameters ?? [];
  const labels = sceneLabels(data);
  const lock = useViewportLock("scene-3d");
  const viewport = useRef<HTMLDivElement>(null);
  const labelElements = useRef<(HTMLSpanElement | null)[]>([]);
  const engine = useRef<Engine | null>(null);
  const placed = useRef("");
  const [values, setValues] = useReaderState(
    "values",
    () => initialValues(parameters),
    { accept: isNumberRecord },
  );
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [theme, setTheme] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [demo, setDemo] = useState<{ id: string; start: number } | null>(null);
  const [resets, setResets] = useState(0);

  const parametersKey = JSON.stringify(parameters);
  const sceneKey = JSON.stringify([
    data.objects,
    data.grid,
    data.axes,
    data.background,
  ]);
  const cameraKey = JSON.stringify(data.camera ?? null);

  // New parameter definitions restart from their declared values.
  useResetOnChange(parametersKey, () => {
    setValues(initialValues(parameters));
    setDemo(null);
  });

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setTheme((value) => value + 1);
    scheme.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => {
      query.removeEventListener("change", update);
      scheme.removeEventListener("change", bump);
      observer.disconnect();
    };
  }, []);

  // One renderer, camera and controller per block; content is rebuilt separately.
  useEffect(() => {
    const host = viewport.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch (caught) {
      setError(
        t("webglFailed", {
          error: caught instanceof Error ? caught.message : String(caught),
        }),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "s3-canvas";
    host.prepend(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
    scene.add(camera);
    scene.add(new HemisphereLight(0xffffff, 0x7d8279, 1.7));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    camera.add(key);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    const current: Engine = {
      renderer,
      scene,
      camera,
      controls,
      helpers: [],
      visible: true,
      frame: 0,
      baseFov: 45,
      invalidate: () => {
        if (!current.frame && current.visible)
          current.frame = requestAnimationFrame(draw);
      },
    };
    const projected = new Vector3();
    const draw = () => {
      current.frame = 0;
      const moving = controls.update();
      renderer.render(scene, camera);
      const { clientWidth: width, clientHeight: height } = renderer.domElement;
      current.content?.anchors.forEach((anchor, index) => {
        const element = labelElements.current[index];
        if (!element) return;
        projected.copy(anchor.local);
        anchor.object.localToWorld(projected);
        projected.y += anchor.lift;
        projected.project(camera);
        const hidden =
          projected.z > 1 ||
          Math.abs(projected.x) > 1.2 ||
          Math.abs(projected.y) > 1.2;
        element.style.visibility = hidden ? "hidden" : "visible";
        element.style.transform = `translate(${((projected.x + 1) / 2) * width}px, ${((1 - projected.y) / 2) * height}px) translate(-50%, -50%)`;
      });
      if (moving || controls.autoRotate) current.invalidate();
    };
    controls.addEventListener("change", current.invalidate);
    const resize = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = host;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      fitFieldOfView(current);
      current.invalidate();
    });
    resize.observe(host);
    const visibility = new IntersectionObserver(([entry]) => {
      current.visible = entry.isIntersecting;
      current.invalidate();
    });
    visibility.observe(host);
    const lost = (event: Event) => {
      event.preventDefault();
      setError(t("webglFailed", { error: "WebGL context lost" }));
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    // WebGL canvases do not print reliably; print a still of the current view instead.
    const print = () => {
      renderer.render(scene, camera);
      try {
        setSnapshot(renderer.domElement.toDataURL("image/png"));
      } catch {
        setSnapshot("");
      }
    };
    window.addEventListener("beforeprint", print);
    engine.current = current;
    // A fresh engine (e.g. after a StrictMode remount) needs its camera placed again.
    placed.current = "";
    return () => {
      window.removeEventListener("beforeprint", print);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      cancelAnimationFrame(current.frame);
      resize.disconnect();
      visibility.disconnect();
      controls.dispose();
      if (current.content) disposeTree(current.content.root);
      current.helpers.forEach(disposeTree);
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    const host = viewport.current!;
    if (current.content) {
      current.scene.remove(current.content.root);
      disposeTree(current.content.root);
    }
    current.helpers.forEach((helper) => {
      current.scene.remove(helper);
      disposeTree(helper);
    });
    current.helpers = [];
    try {
      current.content = buildScene(data);
    } catch (caught) {
      setError(
        t("webglFailed", {
          error: caught instanceof Error ? caught.message : String(caught),
        }),
      );
      return;
    }
    current.scene.add(current.content.root);
    applyBindings(current.content, valuesRef.current);
    current.scene.background = data.background
      ? new Color(data.background)
      : null;
    const bounds = new Box3().setFromObject(current.content.root);
    const extent = bounds.isEmpty()
      ? 4
      : Math.max(...bounds.getSize(new Vector3()).toArray(), 1);
    if (data.grid !== false) {
      const size = Math.ceil(extent * 2.5);
      const grid = new GridHelper(
        size,
        Math.min(size * 2, 40),
        cssColor(host, "--sb-muted", "#92968f"),
        cssColor(host, "--sb-line", "#e9ece5"),
      );
      grid.position.y = bounds.isEmpty() ? 0 : Math.min(0, bounds.min.y);
      const gridMaterial = grid.material as Material;
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.7;
      current.helpers.push(grid);
    }
    if (data.axes) current.helpers.push(new AxesHelper(extent * 0.75));
    current.helpers.forEach((helper) => current.scene.add(helper));
    // A theme change only recolors helpers; it keeps the reader's view.
    const placement = JSON.stringify([sceneKey, cameraKey, resets]);
    if (placed.current !== placement) {
      placed.current = placement;
      placeCamera(current, data);
    }
    setReady(true);
    current.invalidate();
  }, [sceneKey, cameraKey, theme, resets]);

  useEffect(() => {
    const current = engine.current;
    if (!current?.content) return;
    applyBindings(current.content, values);
    current.invalidate();
  }, [values]);

  useEffect(() => {
    const current = engine.current;
    if (!current) return;
    current.controls.enabled = !lock.locked;
    current.controls.autoRotate =
      Boolean(data.camera?.autoRotate) && !reducedMotion;
    current.renderer.domElement.style.touchAction = lock.locked
      ? "pan-y"
      : "none";
    current.invalidate();
  }, [lock.locked, reducedMotion, data.camera?.autoRotate]);

  useEffect(() => {
    if (!demo) return;
    const parameter = parameters.find((item) => item.id === demo.id);
    if (!parameter) return setDemo(null);
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / DEMO_MS);
      setValues((previous) => ({
        ...previous,
        [parameter.id]: demoValue(parameter, demo.start, progress),
      }));
      if (progress < 1) frame = requestAnimationFrame(step);
      else setDemo(null);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [demo]);

  const reset = () => {
    setDemo(null);
    setValues(initialValues(parameters));
    setResets((value) => value + 1);
  };
  const height = data.height ?? 400;

  return (
    <section
      ref={lock.ref}
      className="sb-block s3-block"
      aria-label={blockLabel(data.title, t("title"))}
      data-viewport-lock-scope="scene-3d"
      data-viewport-locked={lock.locked}
    >
      <BlockHeader
        title={data.title}
        defaultTitle={t("title")}
        description={data.description}
      />
      <div className="s3-stage" style={{ height }}>
        <div
          ref={viewport}
          className="s3-viewport"
          role="figure"
          aria-label={
            labels.length
              ? t("canvas", { labels: labels.join(", ") })
              : t("canvasEmpty")
          }
          aria-busy={!ready && !error}
          data-surface-gesture={lock.locked ? undefined : "own"}
        >
          <div className="s3-labels" aria-hidden="true">
            {labels.map((label, index) => (
              <span
                key={`${index}:${label}`}
                ref={(element) => {
                  labelElements.current[index] = element;
                }}
                className="s3-label"
                style={{ visibility: "hidden" }}
              >
                {label}
              </span>
            ))}
          </div>
          {snapshot && <img className="s3-print" src={snapshot} alt="" />}
        </div>
        {!ready && !error && <p className="s3-status">{t("loading")}</p>}
        {error && (
          <div className="s3-status s3-error" role="alert">
            <p>{error}</p>
            {labels.length > 0 && (
              <ul aria-label={t("labels")}>
                {labels.map((label, index) => (
                  <li key={index}>{label}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ViewportLockButton
          {...lock}
          label={t("lockTarget")}
          unlockDescription={t("unlockDescription")}
        />
        <button
          type="button"
          className="s3-reset"
          data-surface-ui
          onClick={reset}
          title={t("resetTitle")}
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t("reset")}
        </button>
        {lock.locked && !error && (
          <span className="s3-hint">{t("dragHint")}</span>
        )}
      </div>
      {parameters.length > 0 && (
        <div
          className="s3-parameters"
          role="group"
          aria-label={t("parameters")}
        >
          {parameters.map((parameter) => {
            const value = values[parameter.id] ?? parameter.value;
            const inputId = `${instanceId}-${parameter.id}`;
            const running = demo?.id === parameter.id;
            const progress =
              ((value - parameter.min) / (parameter.max - parameter.min)) * 100;
            return (
              <div key={parameter.id} className="s3-parameter">
                <div className="s3-parameter-head">
                  <label htmlFor={inputId}>{parameter.label}</label>
                  <output htmlFor={inputId}>
                    {formatValue(value, parameter.step)}
                    {parameter.unit}
                  </output>
                  {parameter.demo && !reducedMotion && (
                    <button
                      type="button"
                      className="s3-demo"
                      data-surface-ui
                      aria-pressed={running}
                      aria-label={t("demo", { label: parameter.label })}
                      onClick={() =>
                        running
                          ? setDemo(null)
                          : setDemo({ id: parameter.id, start: value })
                      }
                    >
                      {running ? (
                        <Square size={12} aria-hidden="true" />
                      ) : (
                        <Play size={12} aria-hidden="true" />
                      )}
                      {running ? t("stop") : t("demoShort")}
                    </button>
                  )}
                </div>
                <input
                  id={inputId}
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step ?? "any"}
                  value={value}
                  style={
                    { "--range-progress": `${progress}%` } as CSSProperties
                  }
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setDemo(null);
                    setValues((previous) => ({
                      ...previous,
                      [parameter.id]: next,
                    }));
                  }}
                />
                {parameter.description && (
                  <p className="s3-parameter-description">
                    {parameter.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
