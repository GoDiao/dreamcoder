// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/boxplot.en.mdx
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
    type: "boxplot",
    autoFit: true,
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/morley.json"),
    },
    encode: {
      x: "Expt",
      y: "Speed",
    },
    style: {
      boxFill: "#1890ff",
      boxFillOpacity: 0.3,
      pointStroke: "#f5222d",
      pointR: 3,
    },
  });

  chart.render();

  await context.flush();
}
