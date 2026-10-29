import { Fragment, type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { BlockProps } from "./types";
import {
  DIAGRAM_TONES,
  LAYER_TONE_ORDER,
  detailParagraphs,
  type DiagramTone,
} from "./doc-diagrams-contract.mjs";
import { InlineMarkup } from "./InlineMarkup";
import "./layer-diagram.css";
import { blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/layerDiagram";
import { NoteText } from "./NoteText";
import { useReaderState } from "../../surface/reader-state";

type Module = { id: string; name: string; path?: string; detail?: string };
type Layer = {
  id: string;
  name: string;
  sub?: string;
  tone?: DiagramTone;
  modules: Module[];
};
type Layers = {
  title?: string;
  caption?: string;
  initial?: string;
  layers: Layer[];
};

/** Paragraphs with **bold**, `code` and safe links; the caption renders inline. */
function RichText({ source, inline }: { source?: string; inline?: boolean }) {
  return (
    <>
      {detailParagraphs(source).map((line, index) =>
        inline ? (
          <Fragment key={index}>
            {index > 0 && " "}
            <InlineMarkup source={line} />
          </Fragment>
        ) : (
          <p key={index}>
            <InlineMarkup source={line} />
          </p>
        ),
      )}
    </>
  );
}

const toneOf = (layer: Layer, index: number): DiagramTone =>
  DIAGRAM_TONES.includes(layer.tone as DiagramTone)
    ? (layer.tone as DiagramTone)
    : LAYER_TONE_ORDER[index % LAYER_TONE_ORDER.length];

export function LayerDiagramBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as Layers;
  const layers = useMemo(
    () =>
      (Array.isArray(model.layers) ? model.layers : []).map((layer, index) => ({
        ...layer,
        tone: toneOf(layer, index),
        modules: Array.isArray(layer.modules) ? layer.modules : [],
      })),
    [model.layers],
  );
  const initial = layers.some((layer) =>
    layer.modules.some((module) => module.id === model.initial),
  )
    ? (model.initial as string)
    : null;
  const [selected, setSelected] = useReaderState<string | null>(
    "selected",
    initial,
    {
      accept: (value) =>
        value === null ||
        layers.some((layer) =>
          layer.modules.some((module) => module.id === value),
        ),
    },
  );
  // A changed initial module in the data resets the reader's selection.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setSelected(initial);
  }
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const layerIndex = layers.findIndex((layer) =>
    layer.modules.some((module) => module.id === selected),
  );
  const layer = layers[layerIndex];
  const module = layer?.modules.find((item) => item.id === selected);

  const move = (event: KeyboardEvent, li: number, mi: number) => {
    if (event.key === "Escape") return setSelected(null);
    let target: Module | undefined;
    const row = layers[li].modules;
    if (event.key === "ArrowRight")
      target = row[Math.min(row.length - 1, mi + 1)];
    else if (event.key === "ArrowLeft") target = row[Math.max(0, mi - 1)];
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      for (let k = li + step; k >= 0 && k < layers.length; k += step) {
        const modules = layers[k].modules;
        if (modules.length) {
          target = modules[Math.min(mi, modules.length - 1)];
          break;
        }
      }
    }
    if (!target) return;
    event.preventDefault();
    buttons.current.get(target.id)?.focus();
    setSelected(target.id);
  };

  return (
    <section
      className="sb-block ly-block"
      aria-label={blockLabel(model.title, t("title"))}
    >
      <div className="ly-top">
        <div>
          {model.title && (
            <h3 className="ly-title">
              <NoteText text={model.title} />
            </h3>
          )}
          {model.caption && (
            <p className="ly-caption">
              <RichText source={model.caption} inline />
            </p>
          )}
        </div>
        <span className="ly-hint">{t("hint")}</span>
      </div>
      <div className="ly-stack">
        {layers.map((item, li) => (
          <Fragment key={item.id}>
            {li > 0 && (
              <div className="ly-link" aria-hidden="true">
                <svg width="12" height="20" viewBox="0 0 12 20">
                  <path d="M6 1v15" />
                  <path d="M2.5 12.5 6 16.5l3.5-4" />
                </svg>
              </div>
            )}
            <section
              className="ly-band"
              data-tone={item.tone}
              data-active={li === layerIndex ? "" : undefined}
              aria-label={item.name}
            >
              <header className="ly-head">
                <span className="ly-index">{li + 1}</span>
                <div>
                  <h4>{item.name}</h4>
                  {item.sub && <small>{item.sub}</small>}
                </div>
              </header>
              <div
                className="ly-modules"
                role="group"
                aria-label={t("modules", { layer: item.name })}
              >
                {item.modules.length ? (
                  item.modules.map((entry, mi) => {
                    const on = entry.id === selected;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className="ly-chip"
                        ref={(element) => {
                          if (element) buttons.current.set(entry.id, element);
                          else buttons.current.delete(entry.id);
                        }}
                        aria-pressed={on}
                        onClick={() => setSelected(on ? null : entry.id)}
                        onKeyDown={(event) => move(event, li, mi)}
                      >
                        <i aria-hidden="true" />
                        {entry.name}
                      </button>
                    );
                  })
                ) : (
                  <span className="ly-none">{t("empty")}</span>
                )}
              </div>
            </section>
          </Fragment>
        ))}
      </div>
      <div
        className="ly-panel"
        data-tone={layer?.tone}
        data-empty={module ? undefined : ""}
        aria-live="polite"
      >
        {module && layer ? (
          <>
            <div className="ly-crumb">
              <span>{layer.name}</span>
              <b aria-hidden="true">/</b>
              <span>{module.name}</span>
            </div>
            <h4>{module.name}</h4>
            {module.path && (
              <code className="ly-path" title={t("path")}>
                {module.path}
              </code>
            )}
            {module.detail && (
              <div className="ly-md">
                <RichText source={module.detail} />
              </div>
            )}
          </>
        ) : (
          <p>{t("prompt")}</p>
        )}
      </div>
      {/* Printed pages cannot select, so every module's path and detail is listed. */}
      <div className="ly-static">
        {layers.map((item) => (
          <div key={item.id} className="ly-static-layer">
            <b>{item.name}</b>
            {item.sub && <span> · {item.sub}</span>}
            <ul>
              {item.modules.map((entry) => (
                <li key={entry.id}>
                  <b>{entry.name}</b>
                  {entry.path && <code>{entry.path}</code>}
                  {entry.detail && (
                    <div className="ly-md">
                      <RichText source={entry.detail} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
