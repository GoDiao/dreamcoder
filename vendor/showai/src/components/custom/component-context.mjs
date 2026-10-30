// What a component hands to the conversation through onContext: `model` is
// visible to the Agent, `private` only returns to the same component instance.
export const componentContextLimits = Object.freeze({
  modelBytes: 8192,
  totalBytes: 16384,
  labelChars: 80,
  depth: 20,
  /** Snapshots from different blocks that travel with one message. */
  perMessage: 6,
});

/** Empty when the snapshot can be handed over, otherwise the reason. The
 * component runtime embeds this function's source, so it stays self-contained. */
export function componentContextIssue(
  snapshot,
  limits = { modelBytes: 8192, totalBytes: 16384, labelChars: 80, depth: 20 },
) {
  const plain = (value) =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const json = (value, depth) => {
    if (depth > limits.depth) return false;
    if (value === null || ["string", "boolean"].includes(typeof value))
      return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every((item) => json(item, depth + 1));
    return (
      plain(value) &&
      Object.entries(value).every(
        ([key, item]) =>
          !["__proto__", "constructor", "prototype"].includes(key) &&
          json(item, depth + 1),
      )
    );
  };
  const bytes = (value) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (!plain(snapshot)) return "The snapshot must be an object.";
  const extra = Object.keys(snapshot).filter(
    (key) => !["model", "private", "label"].includes(key),
  );
  if (extra.length) return `Unknown snapshot fields: ${extra.join(", ")}.`;
  if (snapshot.model === undefined || snapshot.model === null)
    return "model is required.";
  if (!json(snapshot.model, 1)) return "model must contain only JSON values.";
  if (snapshot.private !== undefined && !json(snapshot.private, 1))
    return "private must contain only JSON values.";
  if (
    snapshot.label !== undefined &&
    (typeof snapshot.label !== "string" ||
      !snapshot.label.trim() ||
      snapshot.label.length > limits.labelChars)
  )
    return `label must be non-empty text of at most ${limits.labelChars} characters.`;
  if (bytes(snapshot.model) > limits.modelBytes)
    return `model exceeds ${limits.modelBytes} bytes of JSON.`;
  if (bytes(snapshot) > limits.totalBytes)
    return `The snapshot exceeds ${limits.totalBytes} bytes of JSON.`;
  return "";
}

/** What a component keeps through onViewState: this reader's view on this
 * device (a selected tab, a slider position), restored as `viewState`. */
export const componentViewStateLimits = Object.freeze({ bytes: 16384, depth: 20 });

/** Empty when the view state can be kept, otherwise the reason. The component
 * runtime embeds this function's source, so it stays self-contained. */
export function componentViewStateIssue(
  value,
  limits = { bytes: 16384, depth: 20 },
) {
  const json = (entry, depth) => {
    if (depth > limits.depth) return false;
    if (entry === null || ["string", "boolean"].includes(typeof entry))
      return true;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry))
      return entry.every((item) => json(item, depth + 1));
    return (
      !!entry &&
      typeof entry === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(entry)) &&
      Object.entries(entry).every(
        ([key, item]) =>
          !["__proto__", "constructor", "prototype"].includes(key) &&
          json(item, depth + 1),
      )
    );
  };
  if (value === undefined) return "";
  if (!json(value, 1)) return "viewState must contain only JSON values.";
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.bytes)
    return `viewState exceeds ${limits.bytes} bytes of JSON.`;
  return "";
}
