const themes = new Set(["indigo", "classic", "dark"]);
const interactions = new Set([
  "tooltip",
  "elementHighlight",
  "elementSelect",
  "brushHighlight",
  "brushFilter",
  "legendFilter",
]);
export function validateG2Data(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("图表参数必须是对象。"); // i18n-exempt: contract message shared with CLI/MCP
  if (
    !data.datasets ||
    typeof data.datasets !== "object" ||
    Array.isArray(data.datasets) ||
    !Object.keys(data.datasets).length
  )
    throw new Error("datasets 必须包含图表数据。"); // i18n-exempt: contract message shared with CLI/MCP
  if (data.theme !== undefined && !themes.has(data.theme))
    throw new Error("不支持的图表主题。"); // i18n-exempt: contract message shared with CLI/MCP
  if (
    data.height !== undefined &&
    (!Number.isFinite(data.height) || data.height < 200 || data.height > 900)
  )
    throw new Error("图表高度应为 200 到 900。"); // i18n-exempt: contract message shared with CLI/MCP
  for (const key of ["title", "description"])
    if (data[key] !== undefined && typeof data[key] !== "string")
      throw new Error(key + " 必须是文字。"); // i18n-exempt: contract message shared with CLI/MCP
  for (const key of ["legend", "animation"])
    if (data[key] !== undefined && typeof data[key] !== "boolean")
      throw new Error(key + " 必须是布尔值。"); // i18n-exempt: contract message shared with CLI/MCP
  if (
    data.fields !== undefined &&
    (!data.fields ||
      typeof data.fields !== "object" ||
      Array.isArray(data.fields) ||
      Object.entries(data.fields).some(
        ([k, v]) =>
          ["__proto__", "constructor", "prototype"].includes(k) ||
          typeof v !== "string" ||
          !v,
      ))
  )
    throw new Error("字段对应必须是非空且非保留的字段名。"); // i18n-exempt: contract message shared with CLI/MCP
  if (
    data.interaction !== undefined &&
    (!data.interaction ||
      typeof data.interaction !== "object" ||
      Object.entries(data.interaction).some(
        ([k, v]) => !interactions.has(k) || typeof v !== "boolean",
      ))
  )
    throw new Error("交互配置格式不正确。"); // i18n-exempt: contract message shared with CLI/MCP
  const appearance = data.appearance ?? {};
  if (
    !appearance ||
    typeof appearance !== "object" ||
    Array.isArray(appearance)
  )
    throw new Error("外观配置必须是对象。"); // i18n-exempt: contract message shared with CLI/MCP
  if (
    appearance.palette !== undefined &&
    (!Array.isArray(appearance.palette) ||
      !appearance.palette.length ||
      appearance.palette.length > 20 ||
      appearance.palette.some(
        (v) => typeof v !== "string" || !/^#[a-f\d]{6}$/i.test(v),
      ))
  )
    throw new Error("调色板需要 1 到 20 个六位十六进制颜色。"); // i18n-exempt: contract message shared with CLI/MCP
  for (const [key, min, max] of [
    ["fontSize", 8, 32],
    ["lineWidth", 0, 12],
    ["opacity", 0, 1],
  ])
    if (
      appearance[key] !== undefined &&
      (!Number.isFinite(appearance[key]) ||
        appearance[key] < min ||
        appearance[key] > max)
    )
      throw new Error(key + " 超出允许范围。"); // i18n-exempt: contract message shared with CLI/MCP
  let nodes = 0;
  const json = (value, depth = 0) => {
    if (++nodes > 300000 || depth > 40)
      throw new Error("图表数据过大或嵌套过深。"); // i18n-exempt: contract message shared with CLI/MCP
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach((v) => json(v, depth + 1));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw new Error("数据含有保留字段。"); // i18n-exempt: contract message shared with CLI/MCP
        json(v, depth + 1);
      }
      return;
    }
    throw new Error("数据必须是有限数值或可序列化的 JSON。"); // i18n-exempt: contract message shared with CLI/MCP
  };
  json(data.datasets);
  for (const [key, value] of Object.entries(data.datasets))
    if (!value || typeof value !== "object")
      throw new Error(key + " 必须是数据数组或层级对象。"); // i18n-exempt: contract message shared with CLI/MCP
  return data;
}
