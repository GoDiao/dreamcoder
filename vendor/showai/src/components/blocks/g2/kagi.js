// G2 Kagi concept: https://g2.antv.antgroup.com/en/charts/kagi
// Closing values from G2's official K-chart example, in chronological order.
import { translator } from "../../../i18n";
import messages from "../../../i18n/messages/g2";

const t = translator(messages);

export default async function drawKagi(context) {
  const prices = context.datasets.main;
  if (
    !Array.isArray(prices) ||
    prices.length < 2 ||
    prices.some((v) => !Number.isFinite(v))
  )
    throw new Error(t("error.kagiPrices"));
  const reversal = 0.02;
  let column = 0;
  let direction = 0;
  let extreme = prices[0];
  let lastShoulder = prices[0];
  let lastWaist = prices[0];
  let yang = false;
  const segments = [];
  const append = (a, b, width) => segments.push({ a, b, width });
  for (const price of prices.slice(1)) {
    if (!direction) direction = price >= extreme ? 1 : -1;
    const extending = direction > 0 ? price >= extreme : price <= extreme;
    const reversing =
      direction > 0
        ? price <= extreme * (1 - reversal)
        : price >= extreme * (1 + reversal);
    if (!extending && !reversing) continue;
    if (reversing) {
      if (direction > 0) lastShoulder = extreme;
      else lastWaist = extreme;
      append([column, extreme], [column + 1, extreme], yang ? 4 : 1.5);
      column += 1;
      direction *= -1;
    }
    const threshold =
      direction > 0 && !yang
        ? lastShoulder
        : direction < 0 && yang
          ? lastWaist
          : null;
    const crossing =
      threshold !== null &&
      (direction > 0
        ? price > threshold && extreme <= threshold
        : price < threshold && extreme >= threshold);
    if (crossing) {
      append([column, extreme], [column, threshold], yang ? 4 : 1.5);
      yang = !yang;
      append([column, threshold], [column, price], yang ? 4 : 1.5);
    } else append([column, extreme], [column, price], yang ? 4 : 1.5);
    extreme = price;
  }
  const chart = new context.Chart();
  chart.options({
    type: "view",
    scale: {
      x: { domain: [-0.2, column + 0.2] },
      y: { domain: [Math.min(...prices) * 0.98, Math.max(...prices) * 1.02] },
    },
    children: segments.map((s) => ({
      type: "line",
      data: [s.a, s.b].map(([x, y]) => ({ x, y })),
      encode: { x: "x", y: "y" },
      style: {
        lineWidth: s.width,
        stroke: s.width > 2 ? "#1890ff" : "#30BF78",
      },
      tooltip: false,
    })),
    axis: { x: { title: t("kagi.reversal") }, y: { title: t("kagi.price") } },
  });
  await chart.render();
}
