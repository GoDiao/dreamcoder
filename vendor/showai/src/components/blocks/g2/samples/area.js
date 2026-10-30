// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/area.en.mdx
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
    type: "view",
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
    children: [
      {
        type: "area",
        style: {
          fill: "l(270) 0:#ffffff 0.5:#7ec2f3 1:#1890ff",
          fillOpacity: 0.6,
        },
      },
      {
        type: "line",
        style: {
          lineWidth: 2,
        },
      },
    ],
  });

  chart.render();

  await context.flush();
}
