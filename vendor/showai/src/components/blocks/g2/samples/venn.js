// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/venn.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    autoFit: true,
  });

  chart.options({
    type: "path",
    data: {
      type: "inline",
      value: [
        { sets: ["WeChat"], size: 1200, label: "WeChat" },
        { sets: ["Weibo"], size: 800, label: "Weibo" },
        { sets: ["TikTok"], size: 1000, label: "TikTok" },
        { sets: ["WeChat", "Weibo"], size: 300, label: "WeChat&Weibo" },
        { sets: ["WeChat", "TikTok"], size: 400, label: "WeChat&TikTok" },
        { sets: ["Weibo", "TikTok"], size: 200, label: "Weibo&TikTok" },
        { sets: ["WeChat", "Weibo", "TikTok"], size: 150 },
      ],
      transform: [
        {
          type: "venn",
        },
      ],
    },
    encode: {
      d: "path",
      color: "key",
    },
    labels: [
      {
        position: "inside",
        text: (d) => d.label || "",
      },
    ],
    style: {
      opacity: (d) => (d.sets.length > 1 ? 0.3 : 0.7),
    },
    state: {
      inactive: { opacity: 0.2 },
      active: { opacity: 0.9 },
    },
    interactions: [{ type: "elementHighlight" }],
    legend: false,
  });

  chart.render();

  await context.flush();
}
