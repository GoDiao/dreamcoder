import { Runtime, stdlib, extend } from "@antv/g2";
import { plotlib } from "@antv/g2-extension-plot";
import { Renderer } from "@antv/g-svg";
import { draws } from "./draws.js";
import { translator } from "../../../i18n";
import messages from "../../../i18n/messages/g2";

const t = translator(messages);

export const g2Themes = {
  indigo: {
    base: "classic",
    palette: [
      "#120A8F",
      "#6653CF",
      "#9A89ED",
      "#D0C9F4",
      "#EA8A3B",
      "#53A7A1",
      "#A6629E",
      "#7485AB",
      "#ADC487",
      "#B9B5C8",
    ],
  },
  classic: {
    base: "classic",
    palette: [
      "#1783FF",
      "#00C9C9",
      "#F0884D",
      "#D580FF",
      "#7863FF",
      "#60C42D",
      "#BD8F24",
      "#FF80CA",
      "#2491B3",
      "#17C76F",
    ],
  },
  dark: {
    base: "classicDark",
    palette: [
      "#A99CFF",
      "#69D6D0",
      "#FFA762",
      "#CF98DE",
      "#709EF2",
      "#B0CB77",
      "#F2919A",
      "#89BBD2",
      "#D2BF91",
      "#A6ABBC",
    ],
  },
};
const datasetId = (url) =>
  url
    .split("/")
    .pop()
    .replace(/\.(json|csv|png)$/, "");
function remap(value, fields) {
  if (Array.isArray(value)) return value.map((v) => remap(v, fields));
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, remap(v, fields)]),
  );
  for (const [expected, actual] of Object.entries(fields))
    if (Object.hasOwn(value, actual)) copy[expected] = value[actual];
  return copy;
}
const viewportInteractions = [
  "brushFilter",
  "brushHighlight",
  "sliderFilter",
  "scrollbarFilter",
  "fisheye",
];

function chartInteractions(interaction) {
  return Array.isArray(interaction)
    ? Object.fromEntries(
        interaction.map(({ type, ...options }) => [type, options]),
      )
    : (interaction ?? {});
}

/** Only gestures changed by the reading lock require a lock control. */
export function hasG2ViewportInteraction(spec) {
  const interaction = chartInteractions(spec.interaction);
  const enabled = (value) =>
    value === true || (value && typeof value === "object");
  return viewportInteractions.some((type) => {
    if (interaction[type] === false) return false;
    if (type === "sliderFilter" || type === "scrollbarFilter") {
      const guide = spec[type === "sliderFilter" ? "slider" : "scrollbar"];
      return guide && Object.values(guide).some(enabled);
    }
    return enabled(interaction[type]);
  });
}
export function createG2Context(container, chartType, data, locked = false) {
  const ChartBase = extend(Runtime, { ...stdlib(), ...plotlib() });
  const charts = [],
    renders = new Set();
  let renderError;
  let disposed = false;
  let hasViewportInteraction = false;
  const selected = g2Themes[data.theme ?? "indigo"];
  const palette = data.appearance?.palette ?? selected.palette;
  const textColor = selected.base === "classicDark" ? "#E6E8F0" : "#333";
  let seed = 7;
  const math = Object.create(Math);
  math.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const datasets = remap(data.datasets, data.fields ?? {});
  const get = (key) => {
    if (!Object.hasOwn(datasets, key))
      throw new Error(t("error.missingDataset", { key }));
    return datasets[key];
  };
  const prepare = (input, path = "main", root = true) => {
    const spec = { ...input, animate: data.animation ?? false };
    delete spec.autoFit;
    delete spec.width;
    delete spec.height;
    spec.interaction = chartInteractions(spec.interaction);
    if (root) {
      spec.theme = {
        type: selected.base,
        color: palette[0],
        category10: palette,
      };
      spec.legend = data.legend !== false;
      spec.paddingLeft = 48;
      spec.paddingRight = 26;
      spec.paddingTop = 20;
      spec.paddingBottom = 42;
      spec.interaction = { ...spec.interaction, ...data.interaction };
    }
    hasViewportInteraction ||= hasG2ViewportInteraction(spec);
    if (locked)
      spec.interaction = {
        ...spec.interaction,
        brushFilter: false,
        brushHighlight: false,
        sliderFilter: false,
        scrollbarFilter: false,
        fisheye: false,
      };
    if (input.data?.type === "fetch")
      spec.data = { ...input.data, type: "inline", value: get(path) };
    else if (Array.isArray(input.data))
      spec.data = Object.hasOwn(datasets, path)
        ? get(path)
        : ["dot-map", "bubble-map", "choropleth-map", "kagi"].includes(
              chartType,
            )
          ? input.data
          : get(path);
    else if (
      input.data &&
      typeof input.data === "object" &&
      Object.hasOwn(input.data, "value")
    )
      spec.data = {
        ...input.data,
        value: Object.hasOwn(datasets, path)
          ? get(path)
          : ["dot-map", "bubble-map", "choropleth-map"].includes(chartType)
            ? input.data.value
            : get(path),
      };
    else if (
      input.data &&
      typeof input.data === "object" &&
      !input.data.transform
    )
      spec.data = get(path);
    const records = Array.isArray(spec.data)
      ? spec.data
      : spec.data?.type === "inline"
        ? spec.data.value
        : null;
    if (
      !spec.data?.transform &&
      !spec.transform?.length &&
      Array.isArray(records) &&
      records.length &&
      records.every((r) => r && typeof r === "object" && !Array.isArray(r))
    ) {
      for (const channel of ["x", "y"]) {
        const field = spec.encode?.[channel];
        if (
          typeof field === "string" &&
          !records.some((r) => Object.hasOwn(r, field))
        )
          throw new Error(t("error.missingField", { field }));
      }
    }
    if (spec.style) {
      spec.style = { ...spec.style };
      for (const key of ["fill", "stroke", "labelFill", "labelStroke"]) {
        if (typeof spec.style[key] === "string" && data.theme !== "classic")
          spec.style[key] = spec.style[key]
            .replace(/#1890ff|#5b8ff9/gi, palette[0])
            .replace(/#7ec2f3/gi, palette[2] ?? palette[0]);
        if (
          selected.base === "classicDark" &&
          ["#333", "#000", "#000000", "black"].includes(spec.style[key])
        )
          spec.style[key] = textColor;
      }
    }
    if (
      data.appearance?.lineWidth !== undefined &&
      ["line", "link", "path"].includes(spec.type)
    )
      spec.style = { ...spec.style, lineWidth: data.appearance.lineWidth };
    if (data.appearance?.opacity !== undefined)
      spec.style = { ...spec.style, opacity: data.appearance.opacity };
    if (
      spec.scale?.color?.type === "ordinal" ||
      Array.isArray(spec.scale?.color?.palette)
    )
      spec.scale = {
        ...spec.scale,
        color: { ...spec.scale.color, range: palette, palette: undefined },
      };
    // Composite marks own their axes. Adding x/y guides changes their layout.
    if (
      spec.axis !== false &&
      ![
        "gauge",
        "sunburst",
        "treemap",
        "pack",
        "venn",
        "sankey",
        "geoPath",
      ].includes(spec.type)
    )
      spec.axis = Object.fromEntries(
        ["x", "y"].map((k) => [
          k,
          spec.axis?.[k] === false
            ? false
            : {
                ...spec.axis?.[k],
                labelFontSize: data.appearance?.fontSize ?? 12,
                labelAutoHide: true,
              },
        ]),
      );
    if (data.interaction?.tooltip === false) spec.tooltip = false;
    if (spec.children)
      spec.children = spec.children
        .map((c, index) =>
          c.type === "image" ? null : prepare(c, `layer-${index}`, false),
        )
        .filter(Boolean);
    return spec;
  };
  class Chart extends ChartBase {
    constructor(options = {}) {
      if (disposed) throw new Error(t("error.renderCancelled"));
      super({
        ...options,
        container,
        width: container.clientWidth,
        height: data.height ?? 320,
        autoFit: false,
        renderer: new Renderer(),
      });
      charts.push(this);
    }
    options(value) {
      if (!arguments.length) return super.options();
      let spec = prepare(value);
      if (spec.type === "sankey")
        spec = {
          type: "view",
          theme: spec.theme,
          legend: false,
          axis: false,
          interaction: spec.interaction,
          padding: 32,
          children: [spec],
        };
      return super.options(spec);
    }
    render() {
      const task = super.render();
      renders.add(task);
      task.then(
        () => renders.delete(task),
        (error) => {
          renders.delete(task);
          renderError ??= error;
        },
      );
      return task;
    }
  }
  return {
    get hasViewportInteraction() {
      return hasViewportInteraction;
    },
    Chart,
    container,
    math,
    datasets,
    textColor,
    asset: (url) => "showai-data:" + datasetId(url),
    fetch: async (key) =>
      new Response(JSON.stringify(get(key.replace("showai-data:", ""))), {
        headers: { "content-type": "application/json" },
      }),
    async render() {
      const draw = draws[chartType];
      if (!draw)
        throw new Error(t("error.unsupportedType", { type: chartType }));
      await draw(this);
      await Promise.all([...renders]);
      if (renderError) throw renderError;
    },
    async resize() {
      if (disposed) return;
      await Promise.all(
        charts.map((chart) =>
          chart.changeSize(container.clientWidth, data.height ?? 320),
        ),
      );
    },
    async flush() {
      await Promise.all([...renders]);
      if (renderError) throw renderError;
    },
    destroy() {
      disposed = true;
      charts.forEach((c) => c.destroy());
    },
  };
}
