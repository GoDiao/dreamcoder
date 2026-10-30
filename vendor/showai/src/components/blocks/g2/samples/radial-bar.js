// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/radial-bar.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
    width: 1000,
    height: 700,
  });

  chart.options({
    type: "interval",
    data: [
      { question: "Taiwan Relations", percent: 0.21, odd: 0 },
      { question: "China's Growing Military Power", percent: 0.47, odd: 1 },
      {
        question: "China's Impact on Global Environment",
        percent: 0.49,
        odd: 0,
      },
      { question: "US Trade Deficit with China", percent: 0.52, odd: 1 },
      { question: "China's Human Rights Policy", percent: 0.53, odd: 0 },
      { question: "Cyber Attacks from China", percent: 0.54, odd: 1 },
      { question: "China Taking Away American Jobs", percent: 0.6, odd: 0 },
      { question: "China Holding US Massive Debt", percent: 0.67, odd: 1 },
    ],
    coordinate: { type: "radial", innerRadius: 0.2 },
    encode: {
      x: "question",
      y: "percent",
      color: "odd",
    },
    scale: {
      color: {
        range: ["rgb(211,0,57)", "rgb(224,74,116)"],
      },
      y: { domain: [0, 1] },
    },
    style: {
      radiusTopLeft: 4,
      radiusTopRight: 4,
    },
    label: {
      text: "percent",
      position: "inside",
      style: {
        fontWeight: "bold",
        fill: "white",
      },
    },
    axis: {
      x: {
        label: {
          autoRotate: true,
          autoEllipsis: true,
          style: {
            fontSize: 10,
          },
        },
      },
      y: {
        label: false,
        grid: false,
      },
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
