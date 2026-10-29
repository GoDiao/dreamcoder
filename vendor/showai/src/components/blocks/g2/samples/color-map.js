// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/color-map.en.mdx
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
    type: "cell",
    autoFit: true,
    data: [
      { month: "January", product: "Product A", sales: 123 },
      { month: "January", product: "Product B", sales: 231 },
      { month: "January", product: "Product C", sales: 145 },
      { month: "February", product: "Product A", sales: 132 },
      { month: "February", product: "Product B", sales: 112 },
      { month: "February", product: "Product C", sales: 178 },
      { month: "March", product: "Product A", sales: 99 },
      { month: "March", product: "Product B", sales: 288 },
      { month: "March", product: "Product C", sales: 133 },
      { month: "April", product: "Product A", sales: 181 },
      { month: "April", product: "Product B", sales: 223 },
      { month: "April", product: "Product C", sales: 141 },
      { month: "May", product: "Product A", sales: 152 },
      { month: "May", product: "Product B", sales: 219 },
      { month: "May", product: "Product C", sales: 109 },
      { month: "June", product: "Product A", sales: 167 },
      { month: "June", product: "Product B", sales: 187 },
      { month: "June", product: "Product C", sales: 255 },
    ],
    coordinate: {
      type: "cartesian",
    },
    legend: {
      color: {
        position: "right",
        flipPage: false,
      },
    },
    scale: {
      color: {
        palette: "rdBu",
        offset: (t) => 1 - t,
      },
    },
    encode: {
      x: "month",
      y: "product",
      color: "sales",
      link: "sales",
    },
    style: {
      inset: 1,
    },
    labels: [
      {
        text: "sales",
        style: {
          fill: (d) => (d.sales > 200 ? "#fff" : "#000"),
        },
      },
    ],
  });

  chart.render();

  await context.flush();
}
