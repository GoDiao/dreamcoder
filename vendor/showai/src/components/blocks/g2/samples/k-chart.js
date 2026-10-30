// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/k-chart.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    autoFit: true,
  });

  const data = [
    { time: "2015-11-19", start: 8.18, max: 8.33, min: 7.98, end: 8.32 },
    { time: "2015-11-18", start: 8.37, max: 8.6, min: 8.03, end: 8.09 },
    { time: "2015-11-17", start: 8.7, max: 8.78, min: 8.32, end: 8.37 },
    { time: "2015-11-16", start: 8.48, max: 8.85, min: 8.43, end: 8.7 },
    { time: "2015-11-13", start: 8.01, max: 8.75, min: 7.97, end: 8.41 },
    { time: "2015-11-12", start: 7.76, max: 8.18, min: 7.61, end: 8.15 },
    { time: "2015-11-11", start: 7.55, max: 7.81, min: 7.49, end: 7.8 },
    { time: "2015-11-10", start: 7.5, max: 7.68, min: 7.44, end: 7.57 },
  ];

  const tooltip = {
    title: "time",
    items: [
      { field: "start", name: "Open" },
      { field: "end", name: "Close" },
      { field: "min", name: "Low" },
      { field: "max", name: "High" },
    ],
  };

  chart.options({
    type: "view",
    data,
    encode: {
      x: "time",
      color: (d) => {
        const trend = Math.sign(d.start - d.end);
        // Note: In many Western contexts, red is down and green is up.
        // This example uses red for up ('上涨') and green for down ('下跌').
        // Translated labels: 'Down', 'Unchanged', 'Up'
        // Original colors: Down '#4daf4a' (green), Up '#e41a1c' (red)
        return trend > 0 ? "Down" : trend === 0 ? "Unchanged" : "Up";
      },
    },
    scale: {
      x: {
        compare: (a, b) => new Date(a).getTime() - new Date(b).getTime(),
      },
      color: {
        domain: ["Down", "Unchanged", "Up"],
        range: ["#4daf4a", "#999999", "#e41a1c"], // Green for Down, Gray for Unchanged, Red for Up
      },
    },
    children: [
      {
        type: "link",
        encode: { y: ["min", "max"] },
        tooltip,
      },
      {
        type: "interval",
        encode: { y: ["start", "end"] },
        style: {
          fillOpacity: 1,
          stroke: (d) => {
            if (d.start === d.end) return "#999999";
          },
        },
        axis: {
          y: {
            title: "Price",
          },
        },
        tooltip,
      },
    ],
  });

  chart.render();
  await context.flush();
}
