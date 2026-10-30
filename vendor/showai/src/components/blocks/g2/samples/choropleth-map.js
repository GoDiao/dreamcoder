// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/choropleth-map.en.mdx
// License notices: resources/licenses/g2-runtime.json.
import { feature } from "topojson-client";

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  // Load map and data
  await Promise.all([
    fetch(asset("https://assets.antv.antgroup.com/g2/us-10m.json")).then(
      (res) => res.json(),
    ),
    fetch(asset("https://assets.antv.antgroup.com/g2/unemployment2.json")).then(
      (res) => res.json(),
    ),
  ]).then(([us, unemployment]) => {
    const counties = feature(us, us.objects.states).features;

    const chart = new Chart({
      container: context.container,
      autoFit: true,
    });

    chart.options({
      type: "geoPath",
      coordinate: {
        type: "albersUsa", // Use US-specific map projection
      },
      data: {
        value: counties,
        transform: [
          {
            type: "join",
            join: unemployment,
            on: ["id", "id"],
            select: ["rate","state"],
          },
        ],
      },
      scale: {
        color: {
          palette: "ylGnBu", // Use yellow-to-blue gradient palette
          unknown: "#fff", // Display unknown data as white
        },
      },
      encode: {
        color: "rate", // Map unemployment rate to color channel
      },
      legend: {
        color: {
          layout: { justifyContent: "center" }, // Adjust legend layout
        },
      },
      style: {
        stroke: "#666",
        strokeWidth: 0.5,
      },
      tooltip: {
        title: (d) => d.state??String(d.id),
        items: [{ field: "rate", name: "Unemployment Rate" }],
      },
    });

    chart.render();
  });

  await context.flush();
}
