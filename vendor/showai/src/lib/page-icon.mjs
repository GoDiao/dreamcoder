/** Page icons keep the existing string format: text, a web image, or raster data. */
export const MAX_ICON_LENGTH = 1_000_000;
export function isImageIcon(value) {
  if (typeof value !== "string") return false;
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)
  )
    return true;
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020]/.test(value))
    return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function validatePageIcon(value, path = "page.icon") {
  if (typeof value !== "string")
    throw new Error(`${path} must be text or an image URL.`);
  if (isImageIcon(value)) {
    if (value.length > (value.startsWith("data:") ? MAX_ICON_LENGTH : 2048))
      throw new Error(`${path} image is too large.`);
  } else if (
    value.length > 64 ||
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new Error(
      `${path} must be at most 64 characters, a web image URL, or embedded raster data.`,
    );
  }
  return value;
}
