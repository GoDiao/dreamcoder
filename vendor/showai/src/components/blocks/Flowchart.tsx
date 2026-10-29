import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  BaseEdge,
  EdgeText,
  getSmoothStepPath,
  useReactFlow,
  useNodesState,
  useNodes,
  useNodesInitialized,
  useStore,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { graphlib, layout } from "@dagrejs/dagre";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  X,
} from "../../ui/icons";
import type { BlockProps, BlockData } from "./types";
import { BlockHeader, EmptyState, blockLabel } from "./shared";
import { useViewportLock, ViewportLockButton } from "./ViewportLock";
import {
  journeyStepEdges,
  validateFlowchartData,
} from "./flowchart-contract.mjs";
import { type MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/flowchart";
import "@xyflow/react/dist/style.css";
import "./flowchart.css";
import { isRecord, isText, useReaderState } from "../../surface/reader-state";

type Kind = "request" | "skill" | "decision" | "reference" | "query" | "result";
interface FlowNode extends Record<string, unknown> {
  id: string;
  label: string;
  subtitle?: string;
  kind?: Kind;
  detail?: string;
  commands?: string[];
  references?: string[];
  position?: { x: number; y: number };
  sourceSide?: "top" | "bottom" | "left" | "right";
  targetSide?: "top" | "bottom" | "left" | "right";
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
type StageState = "ok" | "warn" | "bad" | "idle" | "active";
interface JourneyStep {
  node: string;
  edge?: string;
  title: string;
  text: string;
}
interface Journey {
  id: string;
  label: string;
  summary?: string;
  steps: JourneyStep[];
}
interface Stage {
  id: string;
  label: string;
  summary?: string;
  nodes?: Record<string, { state: StageState; note?: string }>;
  edges?: Record<string, { state: StageState; label?: string }>;
}
interface Flow {
  id: string;
  label: string;
  description?: string;
  direction?: "TB" | "LR";
  nodes: FlowNode[];
  edges: FlowEdge[];
  journeys?: Journey[];
  stages?: Stage[];
  initialJourney?: string;
  initialStage?: string;
}
interface FlowData extends BlockData {
  title?: string;
  description?: string;
  height?: number;
  flows: Flow[];
}
type DiagramNode = Node<FlowNode & { direction: "TB" | "LR" }, "showai">;
const kinds: Record<Kind, MessageKey<typeof messages>> = {
  request: "kind.request",
  skill: "kind.skill",
  decision: "kind.decision",
  reference: "kind.reference",
  query: "kind.query",
  result: "kind.result",
};
const stateKeys: Record<StageState, MessageKey<typeof messages>> = {
  ok: "state.ok",
  warn: "state.warn",
  bad: "state.bad",
  idle: "state.idle",
  active: "state.active",
};
const nodeWidth = 176;
const nodeHeight = 72;

/** Reading state only: which journey step or stage is shown. Never saved. */
export type PlaybackMode =
  | { kind: "none" }
  | { kind: "journey"; id: string; step: number }
  | { kind: "stage"; index: number };
export interface NodeView {
  state?: StageState;
  note?: string;
  current?: boolean;
  dim?: boolean;
  badges?: number[];
}
export interface EdgeView {
  state?: StageState;
  label?: string;
  traversed?: boolean;
  current?: boolean;
  flowing?: boolean;
  dim?: boolean;
}
export interface PlaybackView {
  nodes: Map<string, NodeView>;
  edges: Map<string, EdgeView>;
  current?: string;
}

export function initialPlayback(flow: Flow): PlaybackMode {
  if (flow.initialJourney && flow.journeys?.length)
    return { kind: "journey", id: flow.initialJourney, step: 0 };
  if (flow.stages?.length)
    return {
      kind: "stage",
      index: Math.max(
        0,
        flow.stages.findIndex((stage) => stage.id === flow.initialStage),
      ),
    };
  return { kind: "none" };
}
// Edits may remove the journey or stage being read; fall back instead of failing.
function resolvePlayback(flow: Flow, mode: PlaybackMode): PlaybackMode {
  if (mode.kind === "journey") {
    const journey = flow.journeys?.find((item) => item.id === mode.id);
    if (!journey)
      return initialPlayback({ ...flow, initialJourney: undefined });
    return {
      ...mode,
      step: Math.min(Math.max(mode.step, 0), journey.steps.length - 1),
    };
  }
  if (mode.kind === "stage") {
    if (!flow.stages?.length) return { kind: "none" };
    return {
      kind: "stage",
      index: Math.min(Math.max(mode.index, 0), flow.stages.length - 1),
    };
  }
  return mode;
}
export function playbackView(flow: Flow, raw: PlaybackMode): PlaybackView {
  const mode = resolvePlayback(flow, raw);
  const nodes = new Map<string, NodeView>();
  const edges = new Map<string, EdgeView>();
  if (mode.kind === "journey") {
    const journey = flow.journeys!.find((item) => item.id === mode.id)!;
    const stepEdges = journeyStepEdges(flow, journey);
    const walked = journey.steps.slice(0, mode.step + 1);
    for (const item of flow.nodes) nodes.set(item.id, { dim: true });
    walked.forEach((step, index) => {
      const view = nodes.get(step.node)!;
      view.dim = false;
      view.badges = [...(view.badges ?? []), index + 1];
    });
    const current = journey.steps[mode.step].node;
    nodes.get(current)!.current = true;
    for (const edge of flow.edges) edges.set(edge.id, { dim: true });
    stepEdges.slice(0, mode.step + 1).forEach((id, index) => {
      if (!id) return;
      edges.set(id, {
        traversed: true,
        flowing: true,
        current: index === mode.step,
      });
    });
    return { nodes, edges, current };
  }
  if (mode.kind === "stage") {
    const stage = flow.stages![mode.index];
    for (const [id, view] of Object.entries(stage.nodes ?? {}))
      nodes.set(id, { state: view.state, note: view.note });
    for (const [id, view] of Object.entries(stage.edges ?? {}))
      edges.set(id, {
        state: view.state,
        label: view.label,
        flowing: view.state === "bad" || view.state === "active",
      });
  }
  return { nodes, edges };
}
// The most severe state colours a stage chip so readers can scan the timeline.
const severity: StageState[] = ["bad", "warn", "active", "ok", "idle"];
function stageTone(stage: Stage): StageState | undefined {
  const present = new Set(
    Object.values(stage.nodes ?? {}).map((view) => view.state),
  );
  return severity.find((state) => present.has(state));
}

const NodeViewContext = createContext<Map<string, NodeView>>(new Map());
function DiagramCard({ id, data, selected }: NodeProps<DiagramNode>) {
  const t = useTranslator(messages);
  const view = useContext(NodeViewContext).get(id);
  const horizontal = data.direction === "LR";
  const className = [
    "sf-node",
    `sf-${data.kind ?? "query"}`,
    selected && "is-selected",
    view?.state && `sf-state-${view.state}`,
    view?.current && "is-current",
    view?.dim && "is-dim",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={className}
      style={{ width: nodeWidth, minHeight: nodeHeight }}
    >
      <Handle
        type="target"
        position={
          data.targetSide
            ? (data.targetSide as Position)
            : horizontal
              ? Position.Left
              : Position.Top
        }
      />
      {!!view?.badges?.length && (
        <span className="sf-badges">
          {view.badges.map((index) => (
            <i key={index} aria-label={t("stepNumber", { index })}>
              {index}
            </i>
          ))}
        </span>
      )}
      <strong>{data.label}</strong>
      {data.subtitle && (
        <span className="sf-node-subtitle">{data.subtitle}</span>
      )}
      {view?.state && (
        <span className="sf-node-state">
          <i aria-hidden="true" />
          {view.note ? (
            <>
              <span className="sf-sr">{t(stateKeys[view.state])}: </span>
              {view.note}
            </>
          ) : (
            t(stateKeys[view.state])
          )}
        </span>
      )}
      <Handle
        type="source"
        position={
          data.sourceSide
            ? (data.sourceSide as Position)
            : horizontal
              ? Position.Right
              : Position.Bottom
        }
      />
    </div>
  );
}
const nodeTypes = { showai: DiagramCard };

type DiagramEdge = Edge<{ view?: EdgeView; marker: string }, "showai">;
const markerTones = ["base", "path", "warn", "bad", "idle", "active"];
// Markers are drawn here instead of React Flow's colour-keyed markers so their
// colours follow theme tokens through CSS.
function EdgeMarkers({ prefix }: { prefix: string }) {
  return (
    <svg className="sf-markers" aria-hidden="true" width="0" height="0">
      <defs>
        {markerTones.map((tone) => (
          <marker
            key={tone}
            id={`${prefix}-${tone}`}
            className={`sf-marker-${tone}`}
            viewBox="-10 -10 20 20"
            refX="0"
            refY="0"
            markerWidth="12.5"
            markerHeight="12.5"
            markerUnits="strokeWidth"
            orient="auto-start-reverse"
          >
            <polyline
              points="-5,-4 0,0 -5,4 -5,-4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
function FlowLink({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps<DiagramEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const view = data?.view;
  // Healthy edges stay neutral so degraded ones stand out.
  const tone = view?.traversed
    ? "path"
    : view?.state && view.state !== "ok"
      ? view.state
      : "base";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${data?.marker}-${tone})`}
      />
      {view?.flowing && <path d={path} className="sf-edge-flow" />}
      {label && (
        <EdgeText
          x={labelX}
          y={labelY}
          label={label}
          labelStyle={{ fontSize: 13 }}
          labelBgPadding={[6, 3]}
          labelBgBorderRadius={4}
        />
      )}
    </>
  );
}
const edgeTypes = { showai: FlowLink };

function FitFlowViewport({ locked }: { locked: boolean }) {
  const { fitView, viewportInitialized } = useReactFlow();
  const initialized = useNodesInitialized();
  const nodes = useNodes();
  const domNode = useStore((state) => state.domNode);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const previous = useRef<{
    width: number;
    height: number;
    geometry: string;
  } | null>(null);
  const geometry = JSON.stringify(
    nodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
      node.measured?.width,
      node.measured?.height,
    ]),
  );

  useEffect(() => {
    if (!domNode) return;
    const measure = () => {
      const next = { width: domNode.offsetWidth, height: domNode.offsetHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(domNode);
    measure();
    return () => observer.disconnect();
  }, [domNode]);

  useEffect(() => {
    // Hidden tabs have no usable dimensions. React Flow may keep its previous
    // store size, so wait for both the real element and measured nodes.
    if (
      !domNode ||
      !viewportInitialized ||
      !initialized ||
      !size.width ||
      !size.height ||
      width !== size.width ||
      height !== size.height
    )
      return;
    const next = { ...size, geometry },
      last = previous.current;
    if (
      last &&
      (!locked ||
        (last.width === next.width &&
          last.height === next.height &&
          last.geometry === geometry))
    ) {
      previous.current = next;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (
        domNode.offsetWidth !== size.width ||
        domNode.offsetHeight !== size.height
      )
        return;
      previous.current = next;
      void fitView({ padding: 0.08 });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    domNode,
    fitView,
    viewportInitialized,
    initialized,
    size,
    width,
    height,
    geometry,
    locked,
  ]);
  return null;
}

function NodeEditor({
  node,
  onSave,
}: {
  node: FlowNode;
  onSave: (patch: Partial<FlowNode>) => void;
}) {
  const t = useTranslator(messages);
  const [label, setLabel] = useState(node.label);
  const [detail, setDetail] = useState(node.detail ?? "");
  useEffect(() => {
    setLabel(node.label);
    setDetail(node.detail ?? "");
  }, [node.id, node.label, node.detail]);
  return (
    <details className="sf-editor">
      <summary>{t("editNode")}</summary>
      <label>
        {t("nodeName")}
        <input
          value={label}
          aria-invalid={!label.trim()}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label>
        {t("nodeDetail")}
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>
      {!label.trim() && <p role="alert">{t("nodeNameRequired")}</p>}
      <button
        type="button"
        disabled={!label.trim()}
        onClick={() => onSave({ label: label.trim(), detail })}
      >
        {t("saveNode")}
      </button>
    </details>
  );
}
export function layoutFlow(flow: Flow): DiagramNode[] {
  const graph = new graphlib.Graph();
  const direction = flow.direction ?? "TB";
  graph.setGraph({
    rankdir: direction,
    nodesep: 38,
    ranksep: 62,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  flow.nodes.forEach((node) =>
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight }),
  );
  flow.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  layout(graph);
  return flow.nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      id: node.id,
      type: "showai",
      data: { ...node, direction },
      position: node.position ?? {
        x: point.x - nodeWidth / 2,
        y: point.y - nodeHeight / 2,
      },
    };
  });
}
function FlowControls({ locked }: { locked: boolean }) {
  const graph = useReactFlow();
  const t = useTranslator(messages);
  return (
    <div className="sf-controls" aria-label={t("viewControls")}>
      <button
        type="button"
        onClick={() => graph.zoomIn()}
        disabled={locked}
        aria-label={t("zoomIn")}
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        onClick={() => graph.zoomOut()}
        disabled={locked}
        aria-label={t("zoomOut")}
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        onClick={() => graph.fitView({ padding: 0.08, duration: 200 })}
        disabled={locked}
        aria-label={t("fitView")}
      >
        <Maximize2 size={16} />
      </button>
    </div>
  );
}
// Brings the current journey step into view without changing the zoom; a
// locked viewport stays where the reader left it.
function FocusCurrent({ id, locked }: { id?: string; locked: boolean }) {
  const { getNode, getViewport, setCenter } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const size = useRef({ width, height });
  size.current = { width, height };
  const opened = useRef(false);
  useEffect(() => {
    // The first view is the fitted overview; only later steps move the view.
    if (!opened.current) {
      opened.current = true;
      return;
    }
    if (!id || locked) return;
    const node = getNode(id);
    if (!node) return;
    const { x, y, zoom } = getViewport();
    const w = node.measured?.width ?? nodeWidth,
      h = node.measured?.height ?? nodeHeight;
    const left = node.position.x * zoom + x,
      top = node.position.y * zoom + y;
    const { width: viewWidth, height: viewHeight } = size.current;
    if (
      !viewWidth ||
      (left >= 0 &&
        top >= 0 &&
        left + w * zoom <= viewWidth &&
        top + h * zoom <= viewHeight)
    )
      return;
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    void setCenter(node.position.x + w / 2, node.position.y + h / 2, {
      zoom,
      duration: still ? 0 : 320,
    });
  }, [id, locked, getNode, getViewport, setCenter]);
  return null;
}
function FlowCanvas({
  flow,
  height,
  readOnly,
  locked,
  onPosition,
  selected,
  onSelect,
  view,
}: {
  flow: Flow;
  height: number;
  readOnly: boolean;
  locked: boolean;
  onPosition: (id: string, position: { x: number; y: number }) => void;
  selected: string;
  onSelect: (id: string) => void;
  view: PlaybackView;
}) {
  const t = useTranslator(messages);
  const marker = `sf${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layoutNodes = useMemo(() => layoutFlow(flow), [flow]);
  const initialNodes = useMemo(
    () =>
      layoutNodes.map((node) => ({
        ...node,
        selected: node.id === selected,
      })),
    [layoutNodes, selected],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<DiagramNode>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  const edges: DiagramEdge[] = useMemo(
    () =>
      flow.edges.map((edge) => {
        const state = view.edges.get(edge.id);
        return {
          ...edge,
          label: state?.label ?? edge.label,
          type: "showai",
          className: [
            "sf-edge",
            state?.state && `sf-edge-${state.state}`,
            state?.traversed && "is-traversed",
            state?.current && "is-current",
            state?.dim && "is-dim",
          ]
            .filter(Boolean)
            .join(" "),
          data: { view: state, marker },
        };
      }),
    [flow, view, marker],
  );
  return (
    <div
      className="sf-canvas"
      style={{ height }}
      role="group"
      aria-label={flow.label}
    >
      <EdgeMarkers prefix={marker} />
      <NodeViewContext.Provider value={view.nodes}>
        <ReactFlow
          proOptions={{ hideAttribution: true }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          minZoom={0.25}
          maxZoom={2}
          nodesDraggable={!readOnly && !locked}
          panOnDrag={!locked}
          zoomOnScroll={!locked}
          zoomOnPinch={!locked}
          zoomOnDoubleClick={!locked}
          preventScrolling={!locked}
          autoPanOnNodeFocus={!locked}
          autoPanOnNodeDrag={!locked}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          onNodeClick={(_, node) => onSelect(node.id)}
          onNodeDragStop={(_, node) => onPosition(node.id, node.position)}
        >
          <FitFlowViewport locked={locked} />
          <FocusCurrent id={view.current} locked={locked} />
          <FlowControls locked={locked} />
        </ReactFlow>
      </NodeViewContext.Provider>
      <details className="sf-node-picker">
        <summary aria-label={t("nodeList")}>{t("nodes")}</summary>
        <div>
          {flow.nodes.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={selected === item.id}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
function PlaybackChips({
  flow,
  mode,
  onMode,
}: {
  flow: Flow;
  mode: PlaybackMode;
  onMode: (mode: PlaybackMode) => void;
}) {
  const t = useTranslator(messages);
  const journey =
    mode.kind === "journey"
      ? flow.journeys?.find((item) => item.id === mode.id)
      : undefined;
  return (
    <div className="sf-chips">
      {!!flow.journeys?.length && (
        <div className="sf-journeys" role="group" aria-label={t("journeys")}>
          <button
            type="button"
            aria-pressed={mode.kind !== "journey"}
            onClick={() =>
              onMode(
                flow.stages?.length
                  ? initialPlayback({ ...flow, initialJourney: undefined })
                  : { kind: "none" },
              )
            }
          >
            {t("overview")}
          </button>
          {flow.journeys.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={journey?.id === item.id}
              onClick={() => onMode({ kind: "journey", id: item.id, step: 0 })}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {journey?.summary && <p className="sf-summary">{journey.summary}</p>}
      {!!flow.stages?.length && (
        <ol className="sf-stages" aria-label={t("stages")}>
          {flow.stages.map((stage, index) => {
            const tone = stageTone(stage);
            const on = mode.kind === "stage" && mode.index === index;
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  className={tone ? `sf-tone-${tone}` : undefined}
                  aria-pressed={on}
                  aria-current={on ? "step" : undefined}
                  onClick={() => onMode({ kind: "stage", index })}
                >
                  <b>{index + 1}</b>
                  <span>{stage.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
function PlaybackPlayer({
  flow,
  mode,
  playing,
  onMode,
  onPlaying,
}: {
  flow: Flow;
  mode: PlaybackMode;
  playing: boolean;
  onMode: (mode: PlaybackMode) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const t = useTranslator(messages);
  if (mode.kind === "none") return null;
  const journey =
    mode.kind === "journey"
      ? flow.journeys!.find((item) => item.id === mode.id)!
      : undefined;
  const index = mode.kind === "journey" ? mode.step : mode.index;
  const total = journey ? journey.steps.length : flow.stages!.length;
  const go = (next: number) => {
    onPlaying(false);
    const clamped = Math.min(Math.max(next, 0), total - 1);
    onMode(
      journey
        ? { kind: "journey", id: journey.id, step: clamped }
        : { kind: "stage", index: clamped },
    );
  };
  const play = () => {
    if (playing) return onPlaying(false);
    if (index >= total - 1) go(0);
    onPlaying(true);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "ArrowRight") go(index + 1);
    else return;
    event.preventDefault();
  };
  const step = journey?.steps[index];
  const stage = journey ? undefined : flow.stages![index];
  const nodeLabel = step
    ? flow.nodes.find((item) => item.id === step.node)?.label
    : undefined;
  return (
    <div className="sf-player">
      <div
        className="sf-player-bar"
        role="group"
        aria-label={t("playback")}
        onKeyDown={keys}
      >
        <button
          type="button"
          className="sf-player-nav"
          disabled={index === 0}
          aria-label={t(journey ? "previousStep" : "previousStage")}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        {journey && (
          <div className="sf-dots">
            {journey.steps.map((item, at) => (
              <button
                type="button"
                key={at}
                className={at < index ? "is-done" : undefined}
                aria-current={at === index ? "step" : undefined}
                aria-label={t("goToStep", { index: at + 1, title: item.title })}
                onClick={() => go(at)}
              >
                {at + 1}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="sf-player-nav"
          disabled={index >= total - 1}
          aria-label={t(journey ? "nextStep" : "nextStage")}
          onClick={() => go(index + 1)}
        >
          <ChevronRight size={16} />
        </button>
        <span className="sf-player-actions">
          <button
            type="button"
            className="sf-player-play"
            aria-pressed={playing}
            onClick={play}
          >
            {playing ? (
              <span className="sf-pause" aria-hidden="true" />
            ) : (
              <Play size={14} />
            )}
            {t(playing ? "pause" : "play")}
          </button>
          <button
            type="button"
            className="sf-player-restart"
            disabled={index === 0 && !playing}
            onClick={() => go(0)}
          >
            <RotateCcw size={14} />
            {t("restart")}
          </button>
        </span>
      </div>
      <div className="sf-player-text" aria-live="polite">
        <span className="sf-kicker">
          {journey
            ? t("stepOf", { current: index + 1, total })
            : t("stageOf", { current: index + 1, total })}
          {nodeLabel && ` · ${nodeLabel}`}
        </span>
        <strong>{step?.title ?? stage?.label}</strong>
        {(step?.text ?? stage?.summary) && (
          <p>{step?.text ?? stage?.summary}</p>
        )}
      </div>
    </div>
  );
}
// Every journey step and stage as plain text, so printed and exported pages
// keep what the player reveals one step at a time.
function PlaybackOutline({ flow }: { flow: Flow }) {
  const t = useTranslator(messages);
  const id = useId();
  const [open, setOpen] = useState(false);
  const labels = new Map(flow.nodes.map((item) => [item.id, item.label]));
  const edgeNames = new Map(
    flow.edges.map((edge) => [
      edge.id,
      `${labels.get(edge.source)} → ${labels.get(edge.target)}`,
    ]),
  );
  return (
    <div className="sf-outline" data-open={open}>
      <button
        type="button"
        className="sf-outline-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t(open ? "outlineHide" : "outlineShow")}
      </button>
      <div id={id} className="sf-outline-body" aria-label={t("outline")}>
        {flow.journeys?.map((journey) => (
          <section key={journey.id}>
            <h4>{journey.label}</h4>
            {journey.summary && <p>{journey.summary}</p>}
            <ol>
              {journey.steps.map((step, index) => (
                <li key={index}>
                  <b>{step.title}</b>
                  <span> · {labels.get(step.node)}</span>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {flow.stages?.map((stage, index) => (
          <section key={stage.id}>
            <h4>
              {t("stageOf", { current: index + 1, total: flow.stages!.length })}{" "}
              · {stage.label}
            </h4>
            {stage.summary && <p>{stage.summary}</p>}
            <ul>
              {Object.entries(stage.nodes ?? {}).map(([node, view]) => (
                <li key={node} className={`sf-tone-${view.state}`}>
                  <i aria-hidden="true" />
                  {labels.get(node)}: {t(stateKeys[view.state])}
                  {view.note && ` · ${view.note}`}
                </li>
              ))}
              {Object.entries(stage.edges ?? {})
                .filter(([, view]) => view.label || view.state !== "ok")
                .map(([edge, view]) => (
                  <li key={edge} className={`sf-tone-${view.state}`}>
                    <i aria-hidden="true" />
                    {edgeNames.get(edge)}: {t(stateKeys[view.state])}
                    {view.label && ` · ${view.label}`}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
export function FlowchartBlock({
  data: raw,
  onChange,
  readOnly = false,
}: BlockProps) {
  const instanceId = useId();
  const t = useTranslator(messages);
  const lock = useViewportLock("flowchart");
  const data = validateFlowchartData(raw) as FlowData;
  const [flowId, setFlowId] = useReaderState("flow", data.flows[0]?.id ?? "", {
    accept: isText,
  });
  const flow = data.flows.find((item) => item.id === flowId) ?? data.flows[0];
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (flow && !flow.nodes.some((node) => node.id === selected))
      setSelected("");
  }, [flow, selected]);
  const node = flow?.nodes.find((item) => item.id === selected);
  // Playback is reading state: it is reset per flow and never reaches onChange.
  const [rawMode, setMode] = useReaderState<PlaybackMode>(
    "playback",
    () => (flow ? initialPlayback(flow) : { kind: "none" }),
    {
      accept: (value) =>
        isRecord(value) &&
        (value.kind === "none" ||
          (value.kind === "journey" &&
            isText(value.id) &&
            Number.isInteger(value.step)) ||
          (value.kind === "stage" && Number.isInteger(value.index))),
    },
  );
  const [playing, setPlaying] = useState(false);
  const mode = flow ? resolvePlayback(flow, rawMode) : rawMode;
  // resolvePlayback returns a new object each render; key the view by value.
  const modeKey =
    mode.kind === "journey"
      ? `journey:${mode.id}:${mode.step}`
      : mode.kind === "stage"
        ? `stage:${mode.index}`
        : "none";
  const view = useMemo<PlaybackView>(
    () =>
      flow ? playbackView(flow, mode) : { nodes: new Map(), edges: new Map() },
    [flow, modeKey],
  );
  // Restart reading when the source changes which journey or stage opens first.
  const initialKey = `${flow?.id}\n${flow?.initialJourney}\n${flow?.initialStage}`;
  const shownInitial = useRef(initialKey);
  useEffect(() => {
    if (shownInitial.current === initialKey) return;
    shownInitial.current = initialKey;
    if (flow) setMode(initialPlayback(flow));
    setPlaying(false);
  }, [initialKey, flow]);
  const playbackTotal = !flow
    ? 0
    : mode.kind === "journey"
      ? (flow.journeys?.find((item) => item.id === mode.id)?.steps.length ?? 0)
      : mode.kind === "stage"
        ? (flow.stages?.length ?? 0)
        : 0;
  const playbackIndex =
    mode.kind === "journey"
      ? mode.step
      : mode.kind === "stage"
        ? mode.index
        : 0;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (playbackIndex >= playbackTotal - 1) return setPlaying(false);
      setMode((current) =>
        current.kind === "journey"
          ? { ...current, step: playbackIndex + 1 }
          : current.kind === "stage"
            ? { ...current, index: playbackIndex + 1 }
            : current,
      );
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [playing, playbackIndex, playbackTotal]);
  const selectNode = (id: string) => {
    setSelected(id);
    if (mode.kind !== "journey") return;
    const steps = flow.journeys!.find((item) => item.id === mode.id)!.steps;
    if (steps[mode.step].node === id) return;
    const at = steps.findIndex((step) => step.node === id);
    if (at < 0) return;
    setPlaying(false);
    setMode({ ...mode, step: at });
  };
  const stageNodes =
    mode.kind === "stage" ? flow.stages![mode.index].nodes : undefined;
  const stageNode =
    node && stageNodes && Object.hasOwn(stageNodes, node.id)
      ? stageNodes[node.id]
      : undefined;
  const hasPlayback = !!(flow?.journeys?.length || flow?.stages?.length);
  const changeNode = (id: string, patch: Partial<FlowNode>) =>
    onChange?.({
      ...data,
      flows: data.flows.map((item) =>
        item.id === flow.id
          ? {
              ...item,
              nodes: item.nodes.map((node) =>
                node.id === id ? { ...node, ...patch } : node,
              ),
            }
          : item,
      ),
    });
  return (
    <section
      ref={lock.ref}
      className="sb-block sf-block"
      aria-label={blockLabel(data.title, t("flowchart"))}
      data-viewport-lock-scope="flowchart"
      data-viewport-locked={lock.locked}
    >
      <BlockHeader
        title={data.title}
        defaultTitle={t("defaultTitle")}
        description={data.description}
      />
      <ViewportLockButton {...lock} label={t("lockTarget")} />
      {!flow ? (
        <EmptyState title={t("addFlow")} />
      ) : (
        <>
          {data.flows.length > 1 && (
            <div
              className="sf-tabs"
              role="tablist"
              aria-label={t("chooseFlow")}
            >
              {data.flows.map((item) => (
                <button
                  key={item.id}
                  id={`${instanceId}-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={item.id === flow.id}
                  aria-controls={`${instanceId}-panel-${item.id}`}
                  onClick={() => {
                    setFlowId(item.id);
                    setSelected("");
                    setMode(initialPlayback(item));
                    setPlaying(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <div
            role="tabpanel"
            id={`${instanceId}-panel-${flow.id}`}
            aria-labelledby={
              data.flows.length > 1 ? `${instanceId}-tab-${flow.id}` : undefined
            }
          >
            {flow.description && (
              <p className="sf-description">{flow.description}</p>
            )}
            {hasPlayback && (
              <PlaybackChips
                flow={flow}
                mode={mode}
                onMode={(next) => {
                  setPlaying(false);
                  setMode(next);
                }}
              />
            )}
            <ReactFlowProvider key={flow.id}>
              <FlowCanvas
                flow={flow}
                height={data.height ?? 580}
                readOnly={readOnly}
                locked={lock.locked}
                selected={selected}
                onSelect={selectNode}
                view={view}
                onPosition={(id, position) => {
                  if (!readOnly) changeNode(id, { position });
                }}
              />
            </ReactFlowProvider>
            {hasPlayback && (
              <PlaybackPlayer
                flow={flow}
                mode={mode}
                playing={playing}
                onMode={setMode}
                onPlaying={setPlaying}
              />
            )}
            {node &&
              (stageNode ||
                node.detail ||
                node.commands?.length ||
                node.references?.length ||
                (!readOnly && onChange)) && (
                <div className="sf-detail" aria-live="polite">
                  <div className="sf-detail-heading">
                    {node.kind && <span>{t(kinds[node.kind])}</span>}
                    <strong>{node.label}</strong>
                    <button
                      type="button"
                      className="sb-icon-button"
                      aria-label={t("closeNodeDetail")}
                      onClick={() => setSelected("")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {stageNode && (
                    <p className={`sf-stage-note sf-tone-${stageNode.state}`}>
                      <i aria-hidden="true" />
                      {t("stageState", {
                        state: t(stateKeys[stageNode.state]),
                      })}
                      {stageNode.note && ` · ${stageNode.note}`}
                    </p>
                  )}
                  {node.detail && <p>{node.detail}</p>}
                  {!!node.commands?.length && (
                    <div className="sf-detail-group">
                      <span>{t("commands")}</span>
                      {node.commands.map((command) => (
                        <code key={command}>{command}</code>
                      ))}
                    </div>
                  )}
                  {!!node.references?.length && (
                    <div className="sf-detail-group">
                      <span>{t("references")}</span>
                      {node.references.map((reference) => (
                        <code key={reference}>{reference}</code>
                      ))}
                    </div>
                  )}
                  {!readOnly && onChange && (
                    <NodeEditor
                      node={node}
                      onSave={(patch) => changeNode(node.id, patch)}
                    />
                  )}
                </div>
              )}
            {hasPlayback && <PlaybackOutline flow={flow} />}
          </div>
        </>
      )}
    </section>
  );
}
