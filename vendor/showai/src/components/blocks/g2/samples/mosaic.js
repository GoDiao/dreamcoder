// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/mosaic.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    width: 900,
    height: 800,
    paddingLeft: 0,
    paddingRight: 0,
  });

  chart.options({
    type: "interval",
    data: {
      type: "fetch",
      value: asset(
        "https://gw.alipayobjects.com/os/bmw-prod/3041da62-1bf4-4849-aac3-01a387544bf4.csv",
      ),
    },
    transform: [
      { type: "flexX", reducer: "sum" }, // Flexible X-axis width
      { type: "stackY" }, // Y-axis stacking
      { type: "normalizeY" }, // Y-axis normalization
    ],
    encode: {
      x: "market",
      y: "value",
      color: "segment",
    },
    axis: {
      y: false,
    },
    scale: {
      x: { paddingOuter: 0, paddingInner: 0.01 },
    },
    tooltip: "value",
    labels: [
      {
        text: "segment",
        x: 5,
        y: 5,
        textAlign: "start",
        textBaseline: "top",
        fontSize: 10,
        fill: "#fff",
      },
      {
        text: "value",
        x: 5,
        y: 5,
        textAlign: "start",
        dy: 15,
        fontSize: 10,
        fill: "#fff",
      },
    ],
  });

  chart.render();

  await context.flush();
}
