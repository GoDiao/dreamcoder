// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/funnel.en.mdx
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
    data: [
      { stage: "Visits", value: 8043 },
      { stage: "Inquiries", value: 2136 },
      { stage: "Quotes", value: 908 },
      { stage: "Negotiations", value: 691 },
      { stage: "Deals", value: 527 },
    ],
    encode: {
      x: "stage",
      y: "value",
      color: "stage",
      shape: "funnel",
    },
    coordinate: { transform: [{ type: "transpose" }] },
    transform: [
      {
        type: "symmetryY",
      },
    ],
    scale: {
      color: {
        palette: "spectral",
      },
    },
    style: {
      labelText: (d) => `${d.stage}: ${d.value}`,
    },
    animate: { enter: { type: "fadeIn" } },
    axis: false,
    labels: [
      {
        text: (d) => `${d.stage}\n${d.value}`,
        position: "inside",
        transform: [{ type: "contrastReverse" }],
      },
    ],
    legend: false,
  });

  chart.render();

  await context.flush();
}
