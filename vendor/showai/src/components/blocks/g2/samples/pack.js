// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/pack.en.mdx
// License notices: resources/licenses/g2-runtime.json.
import { interpolateHcl } from "d3-interpolate";

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
    autoFit: true,
  });

  chart.options({
    type: "pack",
    width: 800,
    height: 600,
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/flare.json"),
    },
    encode: {
      value: "value",
      color: "depth",
    },
    scale: {
      color: {
        domain: [0, 5],
        range: ["hsl(152,80%,80%)", "hsl(228,30%,40%)"],
        interpolate: interpolateHcl,
      },
    },
    style: {
      labelText: (d) => (d.r >= 10 && d.height === 0 ? `${d.data.name}` : ""),
      labelFontSize: 8,
    },
    legend: { color: false },
    tooltip: {
      title: (d) => d.data.name,
      items: [{ field: "value", name: "Size" }],
    },
  });

  chart.render();

  await context.flush();
}
