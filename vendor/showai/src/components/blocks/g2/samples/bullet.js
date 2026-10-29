// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/bullet.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
  });

  const data = [
    {
      title: "Sales Completion Rate",
      ranges: 100,
      measures: 80,
      target: 85,
    },
  ];

  chart.options({
    type: "view",
    coordinate: { transform: [{ type: "transpose" }] },
    children: [
      {
        type: "interval",
        data,
        encode: { x: "title", y: "ranges", color: "#f0efff" },
        style: { maxWidth: 30 },
        axis: {
          y: {
            grid: true,
            gridLineWidth: 2,
            title: "Completion Rate (%)",
          },
          x: {
            title: false,
          },
        },
      },
      {
        type: "interval",
        data,
        encode: { x: "title", y: "measures", color: "#5B8FF9" },
        style: { maxWidth: 20 },
        label: {
          text: "measures",
          position: "right",
          textAlign: "left",
          dx: 5,
          formatter: (d) => `${d}%`,
        },
      },
      {
        type: "point",
        data,
        encode: {
          x: "title",
          y: "target",
          shape: "line",
          color: "#3D76DD",
          size: 8,
        },
        tooltip: {
          title: false,
          items: [
            {
              channel: "y",
              name: "Target Value",
              valueFormatter: (d) => `${d}%`,
            },
          ],
        },
      },
    ],
  });

  chart.render();

  await context.flush();
}
