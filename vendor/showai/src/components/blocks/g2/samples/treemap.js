// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/treemap.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
    autoFit: true,
  });

  chart.options({
    type: "treemap",
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/flare-treemap.json"),
    },
    layout: {
      path: (d) => d.name.replace(/\./g, "/"),
      tile: "treemapBinary",
      paddingInner: 1,
    },
    encode: {
      value: "size",
      color: (d) => d.parent?.data.name.split(".")[1] || "root",
    },
    style: {
      labelText: (d) => {
        const name = d.data.name
          .split(".")
          .pop()
          .split(/(?=[A-Z][a-z])/g)[0];
        return name;
      },
      labelFill: "#000",
      labelPosition: "top-left",
      labelDx: 3,
      labelDy: 3,
      fillOpacity: 0.7,
    },
    tooltip: {
      title: (d) => d.path?.join?.(".") || d.data.name,
      items: [{ field: "value", name: "Size" }],
    },
  });

  chart.render();

  await context.flush();
}
