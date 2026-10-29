// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/wordcloud.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    width: 600,
  });

  chart.options({
    type: "wordCloud",
    paddingTop: 40,
    layout: { spiral: "rectangular", fontSize: [20, 100] },
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/philosophy-word.json"),
    },
    encode: { color: "text" },
  });

  chart.render();

  await context.flush();
}
