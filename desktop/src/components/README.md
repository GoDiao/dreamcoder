# Desktop component sources

This inventory covers the shared components and the chat/workspace compositions
migrated in #191. Domain components elsewhere in this directory are DreamCoder
code. Their session, permission, task and configuration behavior remains owned
by the existing stores and server APIs.

## Generated primitives

Files in [`shared/ui`](shared/ui) were generated with the shadcn CLI from the
**Radix Nova** registry, then adapted locally. The upstream source is
[shadcn/ui's Radix registry](https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/bases/radix/ui).
File names below are relative to `shared/ui`, with the `.tsx` suffix omitted.
shadcn/ui's MIT license is reproduced in [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md).

| Files | Source and runtime |
| --- | --- |
| `button` | shadcn Button with a local `loading` state (disabled, `aria-busy`, leading Spinner), a local `gradient` variant for the composer send button, and local `row` (full-width list row) and `icon-xl` (mobile touch target) sizes; Radix Slot and class-variance-authority |
| `input`, `textarea` | shadcn native input and textarea wrappers |
| `field`, `label`, `input-group` | shadcn Field, Radix Label and Input Group |
| `card`, `empty`, `skeleton`, `kbd` | shadcn presentation components |
| `progress` | shadcn Progress; Radix Progress |
| `switch`, `checkbox` | shadcn Switch and Checkbox; Radix primitives |
| `select` | shadcn Select; Radix Select |
| `toggle`, `toggle-group` | shadcn Toggle and Toggle Group; Radix primitives |
| `tabs` | shadcn Tabs; Radix Tabs |
| `collapsible` | shadcn Collapsible; Radix Collapsible |
| `dialog`, `alert-dialog` | shadcn Dialog and Alert Dialog; Radix primitives |
| `dropdown-menu`, `context-menu` | shadcn menus; Radix Dropdown Menu and Context Menu |
| `popover`, `hover-card`, `tooltip` | shadcn overlays; corresponding Radix primitives |
| `command` | shadcn Command; cmdk |
| `drawer` | shadcn Drawer; Vaul |
| `sonner` | shadcn Toaster; Sonner, adapted to the existing theme store, mounted once in `App`; `addToast` in the UI store calls Sonner directly |
| `spinner` | shadcn Spinner; lucide icon, a status with a localized label unless `aria-hidden` is passed |
| `resizable` | shadcn Resizable; react-resizable-panels |
| `trace` | shadcn Trace and its Collapsible composition |
| `code-block` | shadcn Code Block presentation; highlighting is supplied by DreamCoder |

Radix imports use the aggregate `radix-ui` package. The registry's `cn` helper
is resolved to [`../lib/utils.ts`](../lib/utils.ts), which uses `clsx` and
`tailwind-merge`; there is no separate `cn` dependency. Exact installed runtime
versions live in `desktop/package.json` and `desktop/bun.lock`.

## Shared compositions and project components

File names are relative to [`shared`](shared), with the `.tsx` suffix omitted.
Business code uses the primitives in [`shared/ui`](shared/ui) directly, with one
entry point per concept: `ui/button` (including its `loading` state),
`ui/spinner`, `ui/switch`, `ui/input` and `ui/checkbox`. Tooltips go through
`Tooltip` below. The files
below are compositions of several primitives or hold application logic; a wrapper
that only renames props or passes them through does not belong here.

| Files | Composition or origin |
| --- | --- |
| `LabeledInput` | Field, Label, `ui/input`, description and validation IDs wired together |
| `LoadingBlock` | A centered Spinner for loading lists and detail pages |
| `SearchField` | Input Group, Input and lucide search/clear icons |
| `SegmentedControl` | Single-selection Toggle Group |
| `Dropdown` | Dropdown Menu radio items with optional descriptions, shared by settings selects and the workspace view switch |
| `FormSelect` | Select with labelled triggers and empty application values encoded as nonempty Radix item values |
| `Modal` | Dialog, localized close action and existing modal props |
| `ConfirmDialog` | Alert Dialog with application confirmation callbacks |
| `MobileBottomSheet` | Drawer with localized title and close control |
| `Tooltip` | The tooltip entry point: a Tooltip and content wrapper that keeps the trigger mounted when the content is empty; the single `TooltipProvider` (400 ms delay) is mounted in `App`. `ActivitySettings` and `TerminalSettings` use `ui/tooltip` directly because they need an instant delay, a controlled open state or custom content |
| `ActionMenu` | Shared Dropdown Menu and Context Menu actions/focus handling; the dropdown also takes single-choice submenus (`MenuChoiceGroup`) |
| `ResponsivePopover` | Popover on desktop and bottom sheet on mobile |
| `CopyButton` | Button, Tooltip and `useCopyAndNotify`, which wraps the clipboard helper with localized success and failure toasts |
| `DirectoryPicker`, `RepositoryLaunchControls` | DreamCoder project/branch workflows using shared popovers, Command and controls |
| `PierreDiffSurface` | DreamCoder adapter around [`@pierre/diffs`](https://diffs.com), with token overrides in [`pierre.css`](shared/pierre.css) |
| `DreamCoderIcon` | DreamCoder brand artwork; not a general-purpose icon set |
| `UpdateChecker` | Nonblocking persistent Sonner notification with Card, Button and Progress; updater state remains in the existing store |

The `Button`, `Spinner`, `Switch`, `Input` and labeled `Textarea` adapters were
removed. Callers pass the shadcn variants and sizes, plus the local ones listed
above, directly, put icons in the children with
`data-icon="inline-start"`, and use `onCheckedChange` and `aria-label` on
`ui/switch`. Labelled inputs use `LabeledInput`; Textarea
consumers use `shared/ui/textarea` or Input Group. Provider and scheduled-task
form selects use `FormSelect`; command and action menus retain their distinct
menu semantics. The composer "+" menu is a Dropdown Menu, so Radix provides its
keyboard navigation and focus return, and it opens on pointer press or from the
keyboard like every other menu. `testSetup.ts` wraps the Testing Library `render` and `renderHook` in the tooltip
provider. The Select and Checkbox
sources were generated with `shadcn add select checkbox --view`, then adapted to
local imports and tokens; the registry's `cn` dependency is resolved to the
existing utility, without adding a package. Time inputs retain the native time
picker through `ui/input`.

## Chat and developer views

| Component or area | Source and local behavior |
| --- | --- |
| `chat/UserMessage` | Plain elements; existing attachments and edit behavior |
| `chat/ThinkingBlock`, `chat/ToolCallBlock` | Trace lines; running-title shimmer in the theme stylesheet, with the existing `ToolCallGroup` grouping and Bash command summaries |
| `chat/CodeViewer`, code in tool output | Code Block + the shared Shiki loader; GitHub light/dark syntax themes, plain text during loading or failure |
| `chat/DiffViewer`, `workspace/WorkspaceCodeSurface` (`WorkspaceDiffSurface`) | Pierre FileDiff; workspace line comments, selection quotes and large-diff virtualization remain local integrations |
| `workspace/WorkspacePanel` file tree | Collapsible + Button composition following the [Radix File Tree pattern](https://ui.shadcn.com/docs/ai-elements/radix/file-tree); `WorkspaceTreeNavigation` owns arrow/Home/End navigation and asynchronous focus handling |
| `workspace/WorkspacePanel` empty, error and loading states | Empty for empty and error messages, Skeleton with a status label while loading |
| `layout/AppShell`, `pages/ActiveSession` panel groups | Resizable; `usePanelWidthPersistence` keeps existing pixel-width preferences |
| `chat/ContextUsageIndicator` | [Context](https://ui.shadcn.com/docs/ai-elements/radix/context): Hover Card, outline icon Button with a usage ring, and Progress, with the existing usage breakdown and mobile drawer |
| `chat/SessionTaskBar`, `chat/InlineTaskSummary` | [Plan](https://ui.shadcn.com/docs/ai-elements/radix/plan): Trace with a collapsible step list, running status and "n of m done"; server task state is unchanged |
| `chat/PermissionDialog`, `chat/AskUserQuestion`, `chat/CurrentTurnChangeCard` | DreamCoder workflows with shadcn buttons, cards and inputs; no Questionnaire or Checkpoint dependency |
| `chat/ComposerShell`, `chat/ChatInput` | DreamCoder composer with shared controls; command, attachment and permission logic remains local |
| `settings/ProviderFormModal`, `settings/BashPathSettings`, `pages/MemorySettings` | Input with LabeledInput, Input Group, Textarea and Button; provider selection uses FormSelect |
| `tasks/NewTaskModal`, `tasks/PromptEditor`, `tasks/DayOfWeekPicker` | FormSelect, Input Group, Checkbox and multiple Toggle Group; existing cron serialization and at-least-one-day constraint |
| `settings/SettingsDisclosureRow`, `chat/LocalSlashCommandPanel` | Collapsible and Tabs with shared buttons; existing content and loading behavior |
| `chat/MessageActionBar`, `chat/ImageGalleryModal`, `chat/ToolResultBlock` | Shared buttons and CopyButton; existing copy, fork, navigation and expand actions |
| `tasks/TaskRow` | Action Menu + Confirm Dialog; keyboard navigation, focus return, pending requests and retryable errors |
| `shared/SelectionPopover` | Shared Popover + Button for chat replies and plain-code, Markdown and Pierre selection quotes; portals outside transformed message containers and preserves captured text and line coordinates |
| `workspace/PreviewLimitBar` | Sticky bar with the shown/total line count and a show-all toggle, shared by the code and diff previews |
| `workspace/WorkspaceQuotePopover` | SelectionPopover with the workspace "add to chat" action, shared by the code, Markdown and Pierre diff surfaces |
| `CommandPalette/CommandPalette`, `layout/ShortcutsDialog` | Command and Kbd respectively, with existing navigation and shortcut data |

AI Elements Context, Plan and File Tree are recipes built from the primitives
listed above; there is no AI Elements or AI SDK package to install. Artifact
cards and the browser panel are outside this migration.

## Local adaptations and updates

- Use the existing seven-theme tokens, with the `ui-` Tailwind color namespace,
  theme radii and shadows. Sonner and Pierre follow the app theme: `dark`,
  `midnight` and `aurora` use dark mode; the other themes use light mode.
- Use lucide SVG icons. Material Symbols and its font are removed. Keep Inter,
  Manrope and JetBrains Mono for application text and code; brand/provider
  artwork remains separate.
- Keep visible strings in both locale files, refs compatible with React 19,
  store subscriptions scoped to selectors, and new source code free of comments.
- Preserve Command's active-descendant synchronization, overlay focus behavior,
  responsive picker behavior and their tests when updating generated sources.
  The Command input syncs its active descendant after the selected row renders
  because cmdk 1.1.1 reads that row before React commits it
  ([upstream issue](https://github.com/dip/cmdk/issues/413)).
- Select, Dropdown Menu and Popover content return focus to the trigger only
  after keyboard use, and a tooltip does not open when focus comes back after a
  pointer interaction (`lib/pointerModality`).
- Vaul, behind `drawer`, is marked unmaintained upstream. It stays as approved in
  #191; fixes to the bottom sheet are ours to make.
- Preserve Pierre's composed-selection handling, new-file comment coordinates,
  the 2,000-line initial preview limit and virtualization above 200 diff lines.
  H5 requires Safari 17.5 or newer.

Run the shadcn CLI from `desktop/` using `bunx --bun shadcn@latest`. Inspect
`info --json`, `docs <component>` and `add <component> --dry-run` before an
addition; use `add <component> --diff` before updating an existing component.
Generate through the CLI, then review imports, icons, dependencies, tokens and
accessibility against the local adaptations above. Do not overwrite local
behavior with unreviewed registry output.

See [CONTRIBUTING](../../../docs/CONTRIBUTING_en.md#development-environment) for
setup. Run `bun run lint` and `bun run test -- --run`
from `desktop/`, plus `bun test` from the repository root before a PR. Automated
checks do not replace seven-theme/bilingual desktop and H5 visual acceptance,
the fixed-baseline streaming benchmark, or same-configuration installer-size
comparison.
