import { cloneSourceValue, ownSourceValue } from "../../surface/source-runtime";
import { RichTextEnvironment } from "../rich-text/environment";
import { AssistantContext } from "../assistant-context";
import { PageLinkContext } from "../page-links";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "../useComponentCatalog";
import {
  Component,
  useContext,
  useMemo,
  memo,
  Suspense,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ComponentStatus, type ComponentStatusState } from "./ComponentStatus";
import {
  getBlockDefinition,
  getRegistryRevision,
  subscribeToBlocks,
} from "./registry";
import type { BlockProps } from "./types";
import "./block.css";
import { BoundWidgetHost, hasBinding } from "../../datasets/widget-host";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/widget";
import { PendingNotice } from "../../ui/PendingNotice";
import { useQueuedMount } from "./mount-queue";

const widgetMessages = translator(messages);

/** A built-in block that cannot show its content, as a component status card. */
function UnavailableBlock({
  kind,
  data,
  readOnly,
  state,
  error,
  stack,
  onRetry,
  unavailable,
}: BlockProps & {
  kind: string;
  state: ComponentStatusState;
  /** The data cannot be read here; nothing is wrong with the component. */
  unavailable?: boolean;
  error?: string;
  stack?: string;
  onRetry?: () => void;
}) {
  const t = useTranslator(messages);
  const assistant = useContext(AssistantContext);
  const definition = getBlockDefinition(kind);
  return (
    <ComponentStatus
      state={state}
      name={definition?.title ?? kind}
      title={
        unavailable
          ? t("status.unavailable", { name: definition?.title ?? kind })
          : undefined
      }
      reference={kind}
      query={kind}
      error={error}
      stack={stack}
      cause={
        state === "missing"
          ? t("status.missingBuiltinCause", { kind })
          : state === "invalid"
            ? error
            : undefined
      }
      data={data}
      readOnly={readOnly}
      assistant={readOnly ? null : assistant}
      onRetry={onRetry}
    />
  );
}

class BlockBoundary extends Component<
  {
    children: ReactNode;
    kind: string;
    data: BlockProps["data"];
    readOnly?: boolean;
  },
  { error: { message: string; stack?: string } | null }
> {
  state = { error: null as { message: string; stack?: string } | null };
  static getDerivedStateFromError(error: Error) {
    return {
      error: {
        message: error?.message || widgetMessages("renderFailed"),
        ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
      },
    };
  }
  componentDidUpdate(previous: { data: BlockProps["data"]; kind: string }) {
    if (
      this.state.error &&
      (previous.data !== this.props.data || previous.kind !== this.props.kind)
    )
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <UnavailableBlock
        kind={this.props.kind}
        data={this.props.data}
        readOnly={this.props.readOnly}
        state="crashed"
        error={this.state.error.message}
        stack={this.state.error.stack}
        onRetry={() => this.setState({ error: null })}
      />
    ) : (
      this.props.children
    );
  }
}

/** A block bound to a shared dataset resolves its props there first. */
export const Widget = memo(function Widget(props: BlockProps & { kind: string }) {
  const host = useContext(BoundWidgetHost);
  if (!hasBinding(props.data))
    return (
      <>
        {host && <host.Action {...props} />}
        <WidgetBody {...props} />
      </>
    );
  return host ? (
    <>
      <host.Action {...props} />
      <host.Bound
        {...props}
        render={(resolved) => <WidgetBody {...resolved} />}
      />
    </>
  ) : (
    <UnavailableBlock
      kind={props.kind}
      data={props.data}
      readOnly={props.readOnly}
      state="invalid"
      unavailable
      error={widgetMessages("sharedDataUnavailable")}
    />
  );
});

const WidgetBody = memo(function WidgetBody({
  kind,
  data,
  onChange,
  readOnly,
  host,
}: BlockProps & { kind: string }) {
  // Components own a mutable working copy, including read-only renderers that
  // internally prepare their data. Published callbacks capture before returning.
  const draft = useMemo(() => cloneSourceValue(data), [data]);
  const publish = onChange && !readOnly
    ? (value: typeof data) => onChange(ownSourceValue(value))
    : undefined;
  const registerComponent = useContext(RegisterComponentContext);
  const assistant = useContext(AssistantContext);
  const pageLinks = useContext(PageLinkContext);
  const environment = useMemo(
    () => ({
      useCatalog: useComponentCatalog,
      registerComponent,
      renderWidget: (props: BlockProps & { kind: string }) => (
        <Widget {...props} />
      ),
      assistant: readOnly ? null : assistant,
      pageLinks: readOnly ? null : pageLinks,
    }),
    [registerComponent, assistant, pageLinks, readOnly],
  );
  useSyncExternalStore(
    subscribeToBlocks,
    getRegistryRevision,
    getRegistryRevision,
  );
  const t = useTranslator(messages);
  const queued = useQueuedMount();
  const definition = getBlockDefinition(kind);
  const pending = (
    <PendingNotice
      ref={queued.placeholder}
      className="sb-block"
      data-preview-pending="true"
      label={t("loading")}
      lines={2}
      minHeight={
        queued.height ??
        (typeof data.height === "number"
          ? data.height
          : kind.startsWith("g2-")
            ? 320
            : 180)
      }
    />
  );
  if (!queued.mounted) return pending;
  if (!definition)
    return (
      <UnavailableBlock
        kind={kind}
        data={data}
        readOnly={readOnly}
        state="missing"
      />
    );
  if (definition.validate) {
    try {
      definition.validate(draft);
    } catch (error) {
      return (
        <UnavailableBlock
          kind={kind}
          data={data}
          readOnly={readOnly}
          state="invalid"
          error={error instanceof Error ? error.message : t("invalidData")}
        />
      );
    }
  }
  const Renderer = definition.renderer;
  return (
    <BlockBoundary key={kind} kind={kind} data={data} readOnly={readOnly}>
      <Suspense fallback={pending}>
        <RichTextEnvironment.Provider value={environment}>
          <Renderer
            data={draft}
            onChange={publish}
            readOnly={readOnly}
            host={host}
          />
        </RichTextEnvironment.Provider>
      </Suspense>
    </BlockBoundary>
  );
});
