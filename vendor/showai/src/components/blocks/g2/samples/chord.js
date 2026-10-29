// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/chord.en.mdx
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
    type: "chord",
    autoFit: true,
    data: {
      value: {
        links: [
          { source: "Beijing", target: "Shanghai", value: 100 },
          { source: "Beijing", target: "Guangzhou", value: 80 },
          { source: "Beijing", target: "Shenzhen", value: 60 },
          { source: "Shanghai", target: "Beijing", value: 70 },
          { source: "Shanghai", target: "Guangzhou", value: 90 },
          { source: "Shanghai", target: "Shenzhen", value: 50 },
          { source: "Guangzhou", target: "Beijing", value: 40 },
          { source: "Guangzhou", target: "Shanghai", value: 85 },
          { source: "Guangzhou", target: "Shenzhen", value: 120 },
          { source: "Shenzhen", target: "Beijing", value: 35 },
          { source: "Shenzhen", target: "Shanghai", value: 45 },
          { source: "Shenzhen", target: "Guangzhou", value: 110 },
        ],
      },
    },
    layout: { nodeWidthRatio: 0.05 },
    scale: {
      color: {
        type: "ordinal",
        range: ["#5B8FF9", "#5AD8A6", "#F6BD16", "#E86452"],
      },
    },
    style: {
      labelFontSize: 12,
      labelFill: "#333",
      linkFillOpacity: 0.6,
    },
    tooltip: {
      items: [
        { field: "source", name: "Source City" },
        { field: "target", name: "Target City" },
        { field: "value", name: "Population Flow" },
      ],
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
