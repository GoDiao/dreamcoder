// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/stacked-bar.en.mdx
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
      { name: "London", month: "Jan.", rainfall: 18.9 },
      { name: "London", month: "Feb.", rainfall: 28.8 },
      { name: "London", month: "Mar.", rainfall: 39.3 },
      { name: "London", month: "Apr.", rainfall: 81.4 },
      { name: "London", month: "May", rainfall: 47 },
      { name: "London", month: "Jun.", rainfall: 20.3 },
      { name: "London", month: "Jul.", rainfall: 24 },
      { name: "London", month: "Aug.", rainfall: 35.6 },
      { name: "Berlin", month: "Jan.", rainfall: 12.4 },
      { name: "Berlin", month: "Feb.", rainfall: 23.2 },
      { name: "Berlin", month: "Mar.", rainfall: 34.5 },
      { name: "Berlin", month: "Apr.", rainfall: 99.7 },
      { name: "Berlin", month: "May", rainfall: 52.6 },
      { name: "Berlin", month: "Jun.", rainfall: 35.5 },
      { name: "Berlin", month: "Jul.", rainfall: 37.4 },
      { name: "Berlin", month: "Aug.", rainfall: 42.4 },
    ],
    encode: { x: "month", y: "rainfall", color: "name" },
    transform: [{ type: "stackY" }],
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
