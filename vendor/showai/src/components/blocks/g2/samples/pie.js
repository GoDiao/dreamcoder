// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/pie.en.mdx
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
    type: "interval",
    autoFit: true,
    data: [
      { browser: "Chrome", value: 61.04 },
      { browser: "Safari", value: 15.12 },
      { browser: "Edge", value: 10.52 },
      { browser: "Firefox", value: 7.19 },
      { browser: "Samsung Internet", value: 2.98 },
      { browser: "Opera", value: 3.15 },
    ],
    encode: {
      y: "value",
      color: "browser",
    },
    transform: [{ type: "stackY" }],
    coordinate: { type: "theta" },
    legend: {
      color: {
        position: "right",
        rowPadding: 5,
      },
    },
  });

  chart.render();

  await context.flush();
}
