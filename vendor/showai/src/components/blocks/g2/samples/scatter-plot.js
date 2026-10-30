// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/scatter-plot.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({ container: context.container });

  chart.options({
    type: "point",
    autoFit: true,
    data: [
      { height: 161, weight: 50 },
      { height: 167, weight: 55 },
      { height: 171, weight: 63 },
      { height: 174, weight: 58 },
      { height: 176, weight: 65 },
      { height: 178, weight: 70 },
      { height: 180, weight: 72 },
      { height: 182, weight: 75 },
      { height: 185, weight: 78 },
      { height: 188, weight: 82 },
    ],
    encode: { x: "height", y: "weight" },
    scale: { x: { range: [0, 1] }, y: { domainMin: 0, nice: true } },
    axis: {
      x: { title: "Height (cm)" },
      y: { title: "Weight (kg)" },
    },
    style: {
      fill: "#1890ff",
      fillOpacity: 0.7,
      stroke: "#1890ff",
      strokeWidth: 2,
      r: 6,
    },
  });

  chart.render();

  await context.flush();
}
