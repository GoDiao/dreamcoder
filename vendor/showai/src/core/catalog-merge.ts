import { canonicalJson } from "./canonical";
import type { MergeConflict } from "../components/custom/types";

const equal = (left: unknown, right: unknown) =>
  left === undefined || right === undefined
    ? left === right
    : canonicalJson(left) === canonicalJson(right);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function hunks(base: string[], next: string[]): Hunk[] {
  let prefix = 0,
    suffix = 0;
  while (
    prefix < base.length &&
    prefix < next.length &&
    base[prefix] === next[prefix]
  )
    prefix++;
  while (
    suffix < base.length - prefix &&
    suffix < next.length - prefix &&
    base[base.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  if (prefix || suffix)
    return hunks(
      base.slice(prefix, base.length - suffix),
      next.slice(prefix, next.length - suffix),
    ).map((change) => ({
      ...change,
      start: change.start + prefix,
      end: change.end + prefix,
    }));
  // Bound memory for large source files; conservative conflicts are preferable
  // to an approximate merge that silently overwrites a change.
  if ((base.length + 1) * (next.length + 1) > 2_000_000) {
    let start = 0,
      suffix = 0;
    while (
      start < base.length &&
      start < next.length &&
      base[start] === next[start]
    )
      start++;
    while (
      suffix < base.length - start &&
      suffix < next.length - start &&
      base[base.length - suffix - 1] === next[next.length - suffix - 1]
    )
      suffix++;
    return [
      {
        start,
        end: base.length - suffix,
        lines: next.slice(start, next.length - suffix),
      },
    ];
  }
  const width = next.length + 1,
    table = new Uint32Array((base.length + 1) * width);
  for (let a = base.length - 1; a >= 0; a--)
    for (let b = next.length - 1; b >= 0; b--)
      table[a * width + b] =
        base[a] === next[b]
          ? table[(a + 1) * width + b + 1] + 1
          : Math.max(table[(a + 1) * width + b], table[a * width + b + 1]);
  const result: Hunk[] = [];
  let a = 0,
    b = 0,
    active: Hunk | undefined;
  const flush = () => {
    if (active) result.push(active);
    active = undefined;
  };
  while (a < base.length || b < next.length) {
    if (a < base.length && b < next.length && base[a] === next[b]) {
      flush();
      a++;
      b++;
      continue;
    }
    active ??= { start: a, end: a, lines: [] };
    if (
      b < next.length &&
      (a === base.length ||
        table[a * width + b + 1] >= table[(a + 1) * width + b])
    )
      active.lines.push(next[b++]);
    else active.end = ++a;
  }
  flush();
  return result;
}

export function mergeText(
  base: string,
  ours: string,
  theirs: string,
  units: "lines" | "characters" = "lines",
): string | undefined {
  const split = (value: string) =>
    units === "characters" ? Array.from(value) : value.split(/(?<=\n)/);
  const lines = split(base);
  const left = hunks(lines, split(ours)),
    right = hunks(lines, split(theirs));
  const changes = [...left];
  for (const candidate of right) {
    let duplicate = false;
    for (const current of left) {
      if (equal(current, candidate)) {
        duplicate = true;
        continue;
      }
      const overlaps =
        current.start === current.end && candidate.start === candidate.end
          ? current.start === candidate.start
          : current.start === current.end
            ? current.start > candidate.start && current.start < candidate.end
            : candidate.start === candidate.end
              ? candidate.start > current.start && candidate.start < current.end
              : current.start < candidate.end && candidate.start < current.end;
      if (overlaps) return undefined;
    }
    if (!duplicate) changes.push(candidate);
  }
  const result = [...lines];
  for (const change of changes.sort(
    (a, b) => b.start - a.start || b.end - a.end,
  ))
    result.splice(change.start, change.end - change.start, ...change.lines);
  return result.join("");
}
/** Transform an old local undo snapshot through later remote text edits.
 * Characters inserted by the remote side have no base identity and are never
 * removed by the local inverse. This also preserves insertions inside a local
 * span being undone, rather than treating them as an overlapping replacement. */
export function rebaseHistoryText(
  base: string,
  snapshot: string,
  remote: string,
): string {
  const original = Array.from(base),
    target = Array.from(snapshot),
    incoming = Array.from(remote);
  const cells: { value: string; original: number | null }[] = original.map(
    (value, index) => ({ value, original: index }),
  );
  for (const change of hunks(original, incoming).sort(
    (a, b) => b.start - a.start,
  ))
    cells.splice(
      change.start,
      change.end - change.start,
      ...change.lines.map((value) => ({ value, original: null })),
    );
  for (const change of hunks(original, target).sort(
    (a, b) => b.start - a.start,
  )) {
    for (let index = cells.length - 1; index >= 0; index--) {
      const identity = cells[index].original;
      if (
        identity !== null &&
        identity >= change.start &&
        identity < change.end
      )
        cells.splice(index, 1);
    }
    let index = cells.findIndex(
      (cell) => cell.original !== null && cell.original >= change.end,
    );
    if (index < 0) index = cells.length;
    cells.splice(
      index,
      0,
      ...change.lines.map((value) => ({ value, original: null })),
    );
  }
  return cells.map((cell) => cell.value).join("");
}

export type MergeChoices = Readonly<Record<string, "ours" | "theirs">>;

/** Missing keys, deletions, and array changes remain distinct from null. */
export function mergeValues(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path = "",
  choices: MergeChoices = {},
): { value: unknown; conflicts: MergeConflict[] } {
  if (equal(ours, theirs) || equal(theirs, base))
    return { value: structuredClone(ours), conflicts: [] };
  if (equal(ours, base))
    return { value: structuredClone(theirs), conflicts: [] };
  if (object(ours) && object(theirs) && (base === undefined || object(base))) {
    const before = object(base) ? base : {},
      value: Record<string, unknown> = {},
      conflicts: MergeConflict[] = [];
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ])) {
      const merged = mergeValues(
        before[key],
        ours[key],
        theirs[key],
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        choices,
      );
      if (merged.value !== undefined) value[key] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }
  const text =
    typeof base === "string" &&
    typeof ours === "string" &&
    typeof theirs === "string" &&
    (path.endsWith("/source") ||
      path.startsWith("/files/") ||
      base.includes("\n"));
  if (text) {
    const merged = mergeText(base, ours, theirs);
    if (merged !== undefined) return { value: merged, conflicts: [] };
  }
  const choice = Object.hasOwn(choices, path || "/")
    ? choices[path || "/"]
    : undefined;
  if (choice)
    return {
      value: structuredClone(choice === "ours" ? ours : theirs),
      conflicts: [],
    };
  return {
    value: structuredClone(ours),
    conflicts: [
      {
        path: path || "/",
        kind: text ? "text" : "value",
        ...(base !== undefined ? { base } : {}),
        ...(ours !== undefined ? { ours } : {}),
        ...(theirs !== undefined ? { theirs } : {}),
      },
    ],
  };
}
