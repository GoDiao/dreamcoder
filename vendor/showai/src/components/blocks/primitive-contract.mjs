import { validateRichTextData } from "../rich-text/model.mjs";
import { validateNativeInk } from "../../surface/native-ink.mjs";

/** Most steps one stepper holds; the editor's hiding rules cover this many. */
export const MAX_STEPS = 12;
export function validatePrimitiveData(kind, data) {
  if (kind !== "text" && data.document) {
    validateRichTextData({ content: data.document, format: "richtext" });
    return;
  }
  for (const key of ["color", "backgroundColor"])
    if (data[key] !== undefined && typeof data[key] !== "string")
      throw new Error(`${key} 必须是文字。`);
  for (const [key, min, max] of [
    ["fontSize", 8, 200],
    ["padding", 0, 200],
    ["radius", 0, 200],
    ["width", 1, 10000],
    ["height", 1, 10000],
  ])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "number" ||
        !Number.isFinite(data[key]) ||
        data[key] < min ||
        data[key] > max)
    )
      throw new Error(`${key} 数值超出范围。`);
  if (
    data.align !== undefined &&
    !["left", "center", "right", "justify"].includes(String(data.align))
  )
    throw new Error("不支持此对齐方式。");
  if (kind === "text") validateRichTextData(data);
  if (kind === "image") {
    if (data.nativeInk !== undefined) {
      validateNativeInk(data.nativeInk);
      if (!data.nativeInk.extent || data.src !== data.nativeInk.preview)
        throw new Error(
          "Native ink image requires a matching preview and extent.",
        );
    }
    for (const key of ["src", "alt", "caption"])
      if (
        (key === "src" || data[key] !== undefined) &&
        typeof data[key] !== "string"
      )
        throw new Error(`${key} 必须是文字。`);
    if (
      data.fit !== undefined &&
      !["contain", "cover"].includes(String(data.fit))
    )
      throw new Error("不支持此图像裁切方式。");
  }
  if (["callout", "toggle"].includes(kind))
    validateRichTextData({ content: data.content });
  if (kind === "stepper") {
    if (
      !Array.isArray(data.steps) ||
      !data.steps.length ||
      data.steps.length > MAX_STEPS
    )
      throw new Error(`逐步切换需要 1 到 ${MAX_STEPS} 个步骤。`);
    for (const step of data.steps) {
      if (!step || typeof step !== "object")
        throw new Error("每个步骤必须是对象。");
      if (step.title !== undefined && typeof step.title !== "string")
        throw new Error("步骤标题必须是文字。");
      validateRichTextData({ content: step.content ?? "" });
    }
  }
  if (kind === "code" && typeof data.content !== "string")
    throw new Error("组件需要文字内容。");
  if (kind === "table") {
    if (
      data.columnAlignments !== undefined &&
      (!Array.isArray(data.columnAlignments) ||
        data.columnAlignments.length !== data.columns?.length ||
        data.columnAlignments.some(
          (value) =>
            value !== null && !["left", "center", "right"].includes(value),
        ))
    )
      throw new Error(
        "列对齐设置必须与列数一致，且只能使用 left、center、right 或 null。",
      );
    if (
      !Array.isArray(data.columns) ||
      !data.columns.length ||
      data.columns.length > 100 ||
      data.columns.some((column) => typeof column !== "string")
    )
      throw new Error("表格需要 1 到 100 个文字表头。");
    if (
      !Array.isArray(data.rows) ||
      data.rows.length > 1000 ||
      data.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== data.columns.length ||
          row.some(
            (cell) =>
              !["string", "number", "boolean"].includes(typeof cell) ||
              (typeof cell === "number" && !Number.isFinite(cell)),
          ),
      )
    )
      throw new Error(
        "表格各行必须和表头列数一致，单元格只支持文字、数字和布尔值。",
      );
  }
}

/** A null column override inherits the table's alignment. */
export function tableColumnAlignment(data, column) {
  return data.columnAlignments?.[column] ?? data.align ?? "left";
}

export function alignTableData(data, column, alignment) {
  if (!["left", "center", "right"].includes(alignment))
    throw new Error("不支持此对齐方式。");
  if (column === null) {
    const { columnAlignments: _overrides, ...rest } = data;
    return { ...rest, align: alignment };
  }
  if (!Number.isInteger(column) || column < 0 || column >= data.columns.length)
    throw new Error("列索引超出范围。");
  const columnAlignments = data.columns.map((_, index) =>
    index === column ? alignment : (data.columnAlignments?.[index] ?? null),
  );
  return { ...data, columnAlignments };
}
