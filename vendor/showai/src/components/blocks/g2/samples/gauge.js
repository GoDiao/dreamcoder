// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/gauge.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    autoFit: true,
  });

  chart.options({
    type: "gauge",
    data: {
      value: {
        target: 120,
        total: 400,
        name: "score",
      },
    },
    legend: false,
  });

  chart.render();

  await context.flush();
}
