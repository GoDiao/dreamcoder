export function isBoardShape(node) {
  return (
    node?.type === "drawing" &&
    ["rectangle", "ellipse", "arrow"].includes(node.attrs?.tool)
  );
}
export function boardFingerNavigates(pointerType, preferences) {
  return (
    pointerType === "touch" &&
    preferences.native &&
    preferences.device === "pad" &&
    !preferences.fingerDrawing
  );
}
export function fingerNavigatesBoard(pointerType) {
  const flags = document.documentElement.dataset;
  return boardFingerNavigates(pointerType, {
    native: flags.native === "ios",
    device: flags.nativeDevice,
    fingerDrawing: flags.fingerDrawing === "true",
  });
}
