import { CAPACITY, assertBytes, base64Bytes } from "../portable/capacity.mjs";
import { isPortableInk, validatePortableInk } from "./portable-ink.mjs";

export const NATIVE_INK_FORMAT = "showai-pencilkit-v1";
export const NATIVE_INK_MIME = "application/vnd.showai.pencilkit";

function embedded(value, mime, label) {
  const prefix = `data:${mime};base64,`;
  if (typeof value !== "string" || !value.startsWith(prefix))
    throw new Error(`${label} requires embedded ${mime} data.`);
  const bytes = base64Bytes(value.slice(prefix.length));
  if (!bytes) throw new Error(`${label} cannot be empty.`);
  assertBytes(label, bytes, CAPACITY.resourceBytes);
}

/** Native archives remain opaque; iPad verifies them with the PencilKit decoder. */
export function validateNativeInk(ink) {
  if (isPortableInk(ink)) return validatePortableInk(ink);
  if (!ink || typeof ink !== "object" || Array.isArray(ink))
    throw new Error("Native ink must be an object.");
  if (
    Object.keys(ink).some(
      (key) =>
        ![
          "format",
          "drawing",
          "preview",
          "darkPreview",
          "strokeCount",
          "extent",
        ].includes(key),
    )
  )
    throw new Error("Unsupported native ink field.");
  if (ink.format !== NATIVE_INK_FORMAT)
    throw new Error("Unsupported native ink format.");
  if (
    !Number.isInteger(ink.strokeCount) ||
    ink.strokeCount < 1 ||
    ink.strokeCount > 100000
  )
    throw new Error("Native ink requires 1–100000 strokes.");
  if (
    ink.extent !== undefined &&
    (!Array.isArray(ink.extent) ||
      ink.extent.length !== 2 ||
      ink.extent.some(
        (value) => !Number.isFinite(value) || value < 1 || value > 1000000,
      ))
  )
    throw new Error("Invalid native ink extent.");
  embedded(ink.drawing, NATIVE_INK_MIME, "Native drawing");
  embedded(ink.preview, "image/png", "Native ink preview");
  if (ink.darkPreview !== undefined)
    embedded(ink.darkPreview, "image/png", "Dark native ink preview");
  return ink;
}
