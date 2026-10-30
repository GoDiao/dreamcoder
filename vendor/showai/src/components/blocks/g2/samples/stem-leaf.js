// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/stem-leaf.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    autoFit: true,
  });

  // Single group data
  const rawData = [
    65, 67, 69, 71, 72, 73, 74, 75, 76, 78, 79, 81, 82, 83, 85, 87, 89, 92, 93,
    95,
  ];

  // Process single-direction stem-and-leaf plot data
  function processSingleStemLeaf(data) {
    const stemMap = new Map();

    data.forEach((score) => {
      const stem = Math.floor(score / 10);
      const leaf = score % 10;
      if (!stemMap.has(stem)) {
        stemMap.set(stem, []);
      }
      stemMap.get(stem).push(leaf);
    });

    // Sort leaves
    Array.from(stemMap.values()).forEach((leaves) => {
      leaves.sort((a, b) => a - b);
    });

    const stems = Array.from(stemMap.keys()).sort((a, b) => b - a); // Sort from large to small
    const chartData = [];

    stems.forEach((stem, index) => {
      const yPos = index;
      const leaves = stemMap.get(stem);

      // Add stem
      chartData.push({
        x: 0.4,
        y: yPos,
        text: `${stem}`,
        type: "stem",
        fill: context.textColor,
        fontSize: 18,
        fontWeight: "bold",
      });

      // Add leaves
      leaves.forEach((leaf, i) => {
        chartData.push({
          x: 0.47 + i * 0.04,
          y: yPos,
          text: `${leaf}`,
          type: "leaf",
          fill: "#1890ff",
          fontSize: 14,
          fontWeight: "normal",
        });
      });
    });

    return { chartData, maxY: stems.length };
  }

  const { chartData, maxY } = processSingleStemLeaf(rawData);

  chart.options({
    type: "view",
    data: chartData,
    children: [
      {
        type: "text",
        encode: {
          x: "x",
          y: "y",
          text: "text",
          fill: "fill",
          fontSize: "fontSize",
          fontWeight: "fontWeight",
        },
        style: {
          textAlign: "center",
          textBaseline: "middle",
        },
      },
      // Add separator line using lineX method
      {
        type: "lineX",
        data: [0.45],
        style: {
          lineWidth: 1,
          stroke: context.textColor,
          strokeOpacity: 0.6,
        },
      },
    ],
    scale: {
      x: { domain: [0, 1], nice: false },
      y: { domain: [-0.5, maxY - 0.5], nice: false },
    },
    axis: false,
  });

  chart.render();

  await context.flush();
}
