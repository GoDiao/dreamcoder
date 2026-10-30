// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/donut-chart.en.mdx
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
    transform: [{ type: "stackY" }], // Add stackY transform
    data: [
      { genre: "Sports", sold: 27500 },
      { genre: "Strategy", sold: 11500 },
      { genre: "Action", sold: 6000 },
      { genre: "Shooter", sold: 3500 },
      { genre: "Other", sold: 1500 },
    ],
    coordinate: { type: "theta", innerRadius: 0.5 },
    encode: { y: "sold", color: "genre" },
    legend: {
      color: { position: "bottom", layout: { justifyContent: "center" } },
    },
    labels: [
      {
        text: "genre",
        style: {
          fontWeight: "bold",
        },
      },
      {
        text: (d, i, data) => {
          const total = data.reduce((acc, curr) => acc + curr.sold, 0);
          const percent = ((d.sold / total) * 100).toFixed(2);
          return `${percent}%`;
        },
        style: {
          fontSize: 10,
          dy: 12,
        },
      },
    ],
  });

  chart.render();

  await context.flush();
}
