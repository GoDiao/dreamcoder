// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/bubble-chart.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
  });

  chart.options({
    type: "point",
    autoFit: true,
    data: {
      type: "fetch",
      value: asset(
        "https://gw.alipayobjects.com/os/antvdemo/assets/data/bubble.json",
      ),
    },
    encode: {
      x: "GDP",
      y: "LifeExpectancy",
      size: "Population",
      color: "continent",
      shape: "point",
    },
    scale: {
      size: { type: "log", range: [4, 20] },
    },
    style: {
      fillOpacity: 0.3,
      lineWidth: 1,
    },
    legend: {
      size: false,
    },
  });

  chart.render();

  await context.flush();
}
