// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/bi-directional-bar.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
  });

  const data = [
    { department: "Dept 0", group: "Group0", people: 37, type: "completed" },
    { department: "Dept 0", group: "Group0", people: 9, type: "uncompleted" },
    { department: "Dept 0", group: "Group1", people: 27, type: "completed" },
    { department: "Dept 0", group: "Group1", people: 10, type: "uncompleted" },
    { department: "Dept 1", group: "Group2", people: 37, type: "completed" },
    { department: "Dept 1", group: "Group2", people: 19, type: "uncompleted" },
    { department: "Dept 1", group: "Group3", people: 37, type: "completed" },
    { department: "Dept 1", group: "Group3", people: 29, type: "uncompleted" },
    { department: "Dept 2", group: "Group4", people: 20, type: "completed" },
    { department: "Dept 2", group: "Group4", people: 2, type: "uncompleted" },
    { department: "Dept 2", group: "Group5", people: 40, type: "completed" },
    { department: "Dept 2", group: "Group5", people: 10, type: "uncompleted" },
    { department: "Dept 3", group: "Group6", people: 25, type: "completed" },
    { department: "Dept 3", group: "Group6", people: 3, type: "uncompleted" },
    { department: "Dept 3", group: "Group7", people: 55, type: "completed" },
    { department: "Dept 3", group: "Group7", people: 8, type: "uncompleted" },
  ];

  const range = ["#7593ed", "#95e3b0", "#6c7893", "#e7c450", "#7460eb"];

  chart.options({
    type: "interval",
    coordinate: { transform: [{ type: "transpose" }] },
    autoFit: true,
    data: data,
    encode: {
      x: "group",
      y: (d) => (d.type === "completed" ? d.people : -d.people),
      color: "department",
    },

    scale: {
      x: { padding: 0.5 },
      color: {
        type: "ordinal",
        range,
      },
    },
    axis: {
      x: { title: "" },
      y: {
        labelFormatter: (d) => {
          return Math.abs(d);
        },
      },
    },
    style: {
      fill: ({ type }, i, data) => {
        if (type === "uncompleted") {
          return "transparent";
        }
      },
      stroke: (d, i, data, ...re) => {
        const { type } = d;
        if (type === "uncompleted") {
          return range[i / 2];
        }
      },
      lineWidth: 2,
    },
    tooltip: {
      title: (d) => {
        return `${d.department}-${d.group}`;
      },
      items: [
        (d, i, data, column) => ({
          name: d.type === "completed" ? "Completed" : "Uncompleted",
          value: d.people,
        }),
      ],
    },
  });

  chart.render();

  await context.flush();
}
