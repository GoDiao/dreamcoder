// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/contourline.en.mdx
// License notices: resources/licenses/g2-runtime.json.

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  // Generate contour line data
  const generateContourLines = () => {
    const lines = [];
    const levels = [20, 40, 60, 80, 100]; // Contour line levels

    levels.forEach((level, index) => {
      // Generate circular lines for each contour level
      const points = [];
      const centerX = 25;
      const centerY = 25;
      const baseRadius = 5 + index * 4;

      for (let angle = 0; angle <= 360; angle += 5) {
        const radian = (angle * Math.PI) / 180;
        const radius = baseRadius + Math.sin((angle * Math.PI) / 45) * 2; // Add some variation
        const x = centerX + radius * Math.cos(radian);
        const y = centerY + radius * Math.sin(radian);
        points.push({ x, y, level, lineId: `line_${level}` });
      }
      lines.push(...points);
    });

    return lines;
  };

  const contourLines = generateContourLines();

  const chart = new Chart({
    container: context.container,
    autoFit: true,
    height: 400,
  });

  chart.options({
    type: "line",
    data: contourLines,
    encode: {
      x: "x",
      y: "y",
      color: "level",
      series: "lineId",
    },
    style: {
      strokeWidth: 2,
      strokeOpacity: 0.8,
    },
    scale: {
      color: {
        type: "sequential",
        palette: "oranges",
      },
      x: { nice: true },
      y: { nice: true },
    },
    axis: {
      x: { title: "Distance (km)" },
      y: { title: "Distance (km)" },
    },
    legend: {
      color: {
        title: "Elevation (m)",
        layout: { justifyContent: "center" },
      },
    },
    tooltip: {
      title: "Contour Information",
      items: [
        {
          field: "level",
          name: "Elevation",
          valueFormatter: (value) => `${value}m`,
        },
      ],
    },
  });

  chart.render();

  await context.flush();
}
