// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/violin.en.mdx
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
    type: "view",
    data: {
      type: "fetch",
      value: asset("https://assets.antv.antgroup.com/g2/species.json"),
    },
    children: [
      {
        type: "density",
        data: {
          transform: [
            {
              type: "kde",
              field: "y",
              groupBy: ["x", "species"],
            },
          ],
        },
        encode: {
          x: "x",
          y: "y",
          series: "species",
          color: "species",
          size: "size",
        },
        tooltip: false,
      },
      {
        type: "boxplot",
        encode: {
          x: "x",
          y: "y",
          series: "species",
          color: "species",
          shape: "violin",
        },
        style: {
          opacity: 0.5,
          strokeOpacity: 0.5,
          point: false,
        },
      },
    ],
  });

  chart.render();

  await context.flush();
}
