// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/histogram.en.mdx
// License notices: resources/licenses/g2-runtime.json.

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
    type: "rect",
    data: {
      type: "fetch",
      value: asset(
        "https://gw.alipayobjects.com/os/antvdemo/assets/data/diamond.json",
      ),
    },
    encode: {
      x: "carat",
      y: "count",
    },
    transform: [{ type: "binX", y: "count" }],
    scale: {
      y: { nice: true },
    },
    axis: {
      x: { title: "Diamond Weight (Carat)" },
      y: { title: "Frequency" },
    },
    style: {
      fill: "#1890FF",
      fillOpacity: 0.9,
    },
  });

  chart.render();

  await context.flush();
}
