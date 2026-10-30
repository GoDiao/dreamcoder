// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/rose.en.mdx
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
    coordinate: { type: "polar" },
    data: [
      { country: "China", cost: 96 },
      { country: "Germany", cost: 121 },
      { country: "USA", cost: 100 },
      { country: "Japan", cost: 111 },
      { country: "Korea", cost: 102 },
      { country: "France", cost: 124 },
      { country: "Italy", cost: 123 },
      { country: "Netherlands", cost: 111 },
      { country: "Belgium", cost: 123 },
      { country: "UK", cost: 109 },
      { country: "Canada", cost: 115 },
      { country: "Russia", cost: 99 },
      { country: "Mexico", cost: 91 },
      { country: "India", cost: 87 },
      { country: "Switzerland", cost: 125 },
      { country: "Australia", cost: 130 },
      { country: "Spain", cost: 109 },
      { country: "Brazil", cost: 123 },
      { country: "Thailand", cost: 91 },
      { country: "Indonesia", cost: 83 },
      { country: "Poland", cost: 101 },
      { country: "Sweden", cost: 116 },
      { country: "Austria", cost: 111 },
      { country: "Czech", cost: 107 },
    ],
    encode: {
      x: "country",
      y: "cost",
      color: "country",
    },
    scale: {
      y: { nice: true },
      color: { palette: "category20" },
    },
    axis: {
      y: { labelFormatter: null },
      x: { grid: true },
    },
    interaction: [
      {
        type: "elementHighlight",
        background: true,
      },
    ],
  });

  chart.render();

  await context.flush();
}
