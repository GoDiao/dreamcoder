// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/sankey.en.mdx
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
    type: "sankey",
    autoFit: true,
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/energy.json"),
      transform: [
        {
          type: "custom",
          // A readable subset of the official energy dataset for this style preview.
          callback: (data) => ({
            links: [...data].sort((a, b) => b.value - a.value).slice(0, 12),
          }),
        },
      ],
    },
    layout: {
      nodeAlign: "center",
      nodePadding: 0.03,
    },
    style: {
      labelSpacing: 3,
      labelText: (d) => (d.key.length > 19 ? d.key.slice(0, 18) + "…" : d.key),
      labelFontWeight: "bold",
      nodeStrokeWidth: 1.2,
      linkFillOpacity: 0.4,
    },
  });

  chart.render();

  await context.flush();
}
