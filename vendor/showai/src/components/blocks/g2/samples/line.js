// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/line.en.mdx
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
    type: "line",
    autoFit: true,
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/aapl.json"),
      transform: [
        {
          type: "map",
          callback: (d) => ({
            ...d,
            date: new Date(d.date),
          }),
        },
      ],
    },
    encode: { x: "date", y: "close" },
    axis: {
      x: {
        title: null,
      },
      y: {
        title: null,
      },
    },
    style: {
      lineWidth: 2,
      stroke: "#1890ff",
    },
  });

  chart.render();

  await context.flush();
}
