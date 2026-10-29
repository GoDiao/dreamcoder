// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/regressioncurve.en.mdx
// License notices: resources/licenses/g2-runtime.json.
import { regressionLinear } from "d3-regression";

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
    autoFit: true,
    data: {
      type: "fetch",
      value: asset(
        "https://assets.antv.antgroup.com/g2/linear-regression.json",
      ),
    },
    children: [
      {
        type: "point",
        encode: { x: (d) => d[0], y: (d) => d[1] },
        scale: { x: { domain: [0, 1] }, y: { domain: [0, 5] } },
        style: { fillOpacity: 0.75, fill: "#1890ff" },
      },
      {
        type: "line",
        data: {
          transform: [
            {
              type: "custom",
              callback: regressionLinear(),
            },
          ],
        },
        encode: { x: (d) => d[0], y: (d) => d[1] },
        style: { stroke: "#30BF78", lineWidth: 2 },
        labels: [
          {
            text: "y = 1.7x + 3.01",
            selector: "last",
            position: "right",
            textAlign: "end",
            dy: -8,
          },
        ],
        tooltip: false,
      },
    ],
    axis: {
      x: { title: "Independent Variable X" },
      y: { title: "Dependent Variable Y" },
    },
  });

  chart.render();

  await context.flush();
}
