// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/gantt.en.mdx
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
    type: "interval",
    autoFit: true,
    data: [
      { name: "Event Planning", startTime: 1, endTime: 4 },
      { name: "Venue Logistics Planning", startTime: 3, endTime: 13 },
      { name: "Select Vendors", startTime: 5, endTime: 8 },
      { name: "Venue Rental", startTime: 9, endTime: 13 },
      { name: "Book Catering Service", startTime: 10, endTime: 14 },
      { name: "Hire Event Decoration Team", startTime: 12, endTime: 17 },
      { name: "Rehearsal", startTime: 14, endTime: 16 },
      { name: "Event Celebration", startTime: 17, endTime: 18 },
    ],
    encode: {
      x: "name",
      y: "startTime",
      y1: "endTime",
      color: "name",
    },
    coordinate: {
      transform: [{ type: "transpose" }],
    },
    axis: {
      x: {
        title: "Tasks",
      },
      y: {
        title: "Time (Days)",
      },
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
