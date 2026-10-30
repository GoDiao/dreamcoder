// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/bar.en.mdx
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
      { genre: "Sports", sold: 275 },
      { genre: "Strategy", sold: 115 },
      { genre: "Action", sold: 120 },
      { genre: "Shooter", sold: 350 },
      { genre: "Other", sold: 150 },
    ],
    encode: { x: "genre", y: "sold", color: "genre" },
    interaction: [
      {
        type: "elementHighlight",
        background: true,
        region: true,
      },
    ],
  });

  chart.render();

  await context.flush();
}
