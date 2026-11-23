# ShowAI (vendored)

The page format, page operations and reader behind the `ShowUI` tool, copied from
[ShowAI](https://github.com/Renaissance-Mind/ShowAI) at commit `9be7012364d7329e5de159e93b25fa1a9b2f6bae`
(version 0.10.0, MIT license, see `LICENSE`).

## What is here

Only the source files reachable from two entry points, with their paths unchanged:

- `src/agent/page-authoring.ts`: creates a page from `{ kind, data }` blocks. With
  `src/core/diff.ts` (`applyOperations`) and `src/portable/validation.mjs` (`validateDocument`)
  it is the write path the CLI uses.
- `src/portable/cdn.tsx`: the reader, `mount(element, { artifact, options })`. `build-reader.ts`
  bundles it into code-split modules that the sidecar serves under `/showai-reader/`.

`src/portable/template-bundle.mjs` and `template-bundle.d.mts` are copied only because
`src/components/custom/types.ts` refers to their types with `import("…")`; neither entry point
reaches them at runtime.

`resources/catalog/` holds the component catalogs: names, data formats and examples. Dependency
versions in `package.json` match ShowAI's lockfile at that commit.

## Changes from upstream

- No upstream file is changed. `src/utils/uiPages.ts` decides which component kinds pages may use;
  the media kinds (image, gallery, video, audio, bookmark) stay out because pages cannot load
  anything over the network.
- `src/portable/component-signature.mjs` is copied as well; the `ShowUI` catalog uses it for the
  one-line data signature of each component.
- Three declaration files are ours. `src/core/model.ts` refers to types in three upstream modules
  with `import("…")`, and copying those modules would pull in at least 55 more files (the library
  storage layer). Each file copies only the referenced types from upstream, unchanged:
  - `src/sync/conflict-retention.d.ts`: `ConflictSource` and `RetainedConflict` from
    `src/sync/conflict-retention.ts`.
  - `src/core/workspace-conflicts.d.ts`: `WorkspaceConflict` from `src/core/workspace-conflicts.ts`.
  - `src/core/agent-created.d.ts`: `AgentCreatedMark` from `src/core/agent-created.ts`.
- `build-reader.ts` is ours, adapted from upstream `scripts/build-cdn-reader.mjs`.
- `build-g2-fields.ts` is ours. It writes `resources/catalog/g2-fields.json`: for each G2 chart, the
  dataset keys of its example and the record fields its drawing code reads. `ShowUI` rejects a G2
  block whose records lack those fields, which upstream leaves to an empty chart.

## Updating

Check out the new ShowAI commit, bundle the two entry points with esbuild's metafile to list the
source files they reach, copy those files over these, along with the files that their type-only
`import("…")` references point to, except the three modules covered by the declaration files
above, apply the changes above again, and update `package.json` from
ShowAI's lockfile. Compare the types in the three declaration files with their upstream definitions
and copy any change. Run `bun build-g2-fields.ts` here to refresh the G2 field
list, then `bun install`, `bun test` at the repository
root and `bun run build` in `desktop/`.
