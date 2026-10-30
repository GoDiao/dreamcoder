// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/radar-chart.en.mdx
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
    type: "area",
    coordinate: {
      type: "polar",
    },
    autoFit: true,
    data: [
      { ability: "Language", score: 8.8 },
      { ability: "Logic", score: 9.0 },
      { ability: "Affinity", score: 7.2 },
      { ability: "Sports", score: 4.5 },
      { ability: "Learning", score: 8.3 },
    ],
    encode: { x: "ability", y: "score" },
    scale: {
      x: { padding: 0.5, align: 0 },
      y: {
        domainMin: 0,
        domainMax: 10,
        tickCount: 5,
        label: false,
      },
    },
    style: {
      fillOpacity: 0.5,
      lineWidth: 2,
    },
    axis: {
      x: { grid: true },
      y: { tick: false, grid: true, title: false, zIndex: 1 },
    },
    interaction: {
      tooltip: { crosshairsLineDash: [4, 4] },
    },
  });

  chart.render();

  await context.flush();
}
