// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/heatmap.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    autoFit: true,
    padding: 0,
  });

  chart.options({
    type: "view",
    axis: false,
    children: [
      {
        type: "image",
        style: {
          src: asset(
            "https://gw.alipayobjects.com/zos/rmsportal/NeUTMwKtPcPxIFNTWZOZ.png",
          ),
          x: "50%",
          y: "50%",
          width: "100%",
          height: "100%",
        },
        tooltip: false,
      },
      {
        type: "heatmap",
        data: {
          type: "fetch",
          value: asset("https://assets.antv.antgroup.com/g2/heatmap.json"),
        },
        encode: {
          x: "g",
          y: "l",
          color: "tmp",
        },
        style: {
          opacity: 0.85,
        },
        tooltip: false,
      },
    ],
  });

  chart.render();

  await context.flush();
}
