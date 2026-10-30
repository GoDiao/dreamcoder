// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/dot-map.en.mdx
// License notices: resources/licenses/g2-runtime.json.
import { feature } from "topojson-client";

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  /**
   * Airport Distribution Dot Map Based on Real US Map Data
   */
  await Promise.all([
    fetch(asset("https://assets.antv.antgroup.com/g2/us-10m.json")).then(
      (res) => res.json(),
    ),
    fetch(asset("https://assets.antv.antgroup.com/g2/airports.json")).then(
      (res) => res.json(),
    ),
  ]).then((values) => {
    const [us, airports] = values;
    const states = feature(us, us.objects.states).features;

    const chart = new Chart({
      container: context.container,
      autoFit: true,
    });

    chart.options({
      type: "geoView",
      coordinate: { type: "albersUsa" },
      children: [
        {
          type: "geoPath",
          data: states,
          style: {
            fill: "#f5f5f5",
            stroke: "#d0d0d0",
            lineWidth: 1,
          },
        },
        {
          type: "point",
          data: airports,
          encode: {
            x: "longitude",
            y: "latitude",
            color: "#1890ff",
            shape: "point",
            size: 2,
          },
          style: {
            opacity: 0.8,
          },
          tooltip: {
            title: "name",
            items: [
              { name: "Airport Code", field: "iata" },
              { name: "Longitude", field: "longitude" },
              { name: "Latitude", field: "latitude" },
            ],
          },
        },
      ],
    });

    chart.render();
  });

  await context.flush();
}
