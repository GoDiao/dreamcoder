// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/bubble-map.en.mdx
// License notices: resources/licenses/g2-runtime.json.
import { feature } from "topojson-client";

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  await Promise.all([
    fetch(
      asset("https://assets.antv.antgroup.com/g2/londonBoroughs.json"),
    ).then((res) => res.json()),
    fetch(
      asset("https://assets.antv.antgroup.com/g2/londonCentroids.json"),
    ).then((res) => res.json()),
  ]).then((values) => {
    const [londonBoroughs, londonCentroids] = values;
    const london = feature(
      londonBoroughs,
      londonBoroughs.objects.boroughs,
    ).features;

    // Add simulated population and GDP data to centroid data
    const bubbleData = londonCentroids.map((d, index) => ({
      ...d,
      name: d.name || `Area ${index + 1}`, // Ensure each data point has a name
      population: Math.floor(Math.random() * 500000) + 100000, // 100K-600K population
      gdp: Math.floor(Math.random() * 50000) + 20000, // 20K-70K GDP
      category: ["Business", "Residential", "Industrial", "Mixed"][
        Math.floor(Math.random() * 4)
      ],
    }));

    const chart = new Chart({
      container: context.container,
      autoFit: true,
    });

    chart.options({
      type: "geoView",
      children: [
        {
          type: "geoPath",
          data: london,
          style: {
            fill: "lightgray",
            stroke: "white",
            lineWidth: 1,
          },
        },
        {
          type: "point",
          data: bubbleData,
          encode: {
            x: "cx",
            y: "cy",
            size: "population",
            color: "category",
            shape: "point",
          },
          style: {
            opacity: 0.7,
            stroke: "white",
            lineWidth: 1,
          },
          scale: {
            size: {
              range: [4, 30],
            },
            color: {
              range: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"],
            },
          },
          tooltip: {
            title: "name",
            items: [
              {
                name: "Population",
                channel: "size",
                valueFormatter: (value) =>
                  `${value ? value.toLocaleString() : "N/A"} people`,
              },
              {
                name: "GDP",
                field: "gdp",
                valueFormatter: (value) =>
                  `${value ? value.toLocaleString() : "N/A"} million`,
              },
              { name: "Type", field: "category" },
            ],
          },
        },
      ],
    });

    chart.render();
  });

  await context.flush();
}
