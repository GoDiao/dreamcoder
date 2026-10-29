import { useState, type KeyboardEvent } from "react";
import {
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  Undo2,
  Redo2,
  Columns3,
  ListTree,
} from "../ui/icons";
import type { PageWidthMode } from "./types";
import { PageWidthSwitch } from "./PageWidthSwitch";
import {
  LibraryContextMenu,
  type LibraryContextMenuItem,
} from "../studio/LibraryContextMenu";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import outlineMessages from "../i18n/messages/pageOutline";

const translate = translator(messages);
const outlineTranslate = translator(outlineMessages);

export interface EditorControls {
  documentId: string;
  surfaceId: string;
  name: string;
  kind: "page" | "board";
  nested: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  setIcon: () => void;
  wrap: (kind: "page" | "board") => void;
  pageWidthMode: PageWidthMode;
  setPageWidthMode: (mode: PageWidthMode) => void;
  outlineSettings: () => void;
}

export function EditorHistoryButtons({
  controls,
  className = "studio-icon",
}: {
  controls: EditorControls | null;
  className?: string;
}) {
  const t = useTranslator(messages);
  const historyKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !controls ||
      event.nativeEvent.isComposing ||
      !(event.metaKey || event.ctrlKey) ||
      event.altKey
    )
      return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey || key === "y") controls.redo();
    else controls.undo();
  };
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={t("history.undo")}
        title={t("history.undoTitle")}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={historyKey}
        disabled={!controls?.canUndo}
        onClick={() => controls?.undo()}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        className={className}
        aria-label={t("history.redo")}
        title={t("history.redoTitle")}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={historyKey}
        disabled={!controls?.canRedo}
        onClick={() => controls?.redo()}
      >
        <Redo2 size={15} />
      </button>
    </>
  );
}

export function containerMenuItems(
  controls: EditorControls,
  includeIcon = true,
): LibraryContextMenuItem[] {
  const t = translate;
  const name = controls.nested ? controls.name : "";
  return [
    ...(includeIcon
      ? [
          {
            label: name
              ? t("container.setIconFor", { name })
              : t("container.setIcon"),
            icon: <FileText size={15} />,
            onSelect: controls.setIcon,
          },
        ]
      : []),
    ...(controls.kind === "page"
      ? [
          {
            label: outlineTranslate("settings"),
            icon: <ListTree size={15} />,
            onSelect: controls.outlineSettings,
          },
          {
            label: t("pageWidth"),
            icon: <Columns3 size={15} />,
            separatorBefore: true,
            control: (
              <PageWidthSwitch
                value={controls.pageWidthMode}
                onChange={controls.setPageWidthMode}
              />
            ),
          },
        ]
      : []),
    {
      label: name
        ? t("container.wrapBoardFor", { name })
        : t("container.wrapBoard"),
      icon: <LayoutDashboard size={15} />,
      separatorBefore: controls.kind === "page",
      onSelect: () => controls.wrap("board"),
    },
    {
      label: name
        ? t("container.wrapPageFor", { name })
        : t("container.wrapPage"),
      icon: <FileText size={15} />,
      onSelect: () => controls.wrap("page"),
    },
  ];
}

export function EditorContainerMenu({
  controls,
}: {
  controls: EditorControls;
}) {
  const t = useTranslator(messages);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label={t("container.actions")}
        title={t("container.actions")}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </button>
      {anchor && (
        <LibraryContextMenu
          anchor={anchor}
          label={t("container.actionsFor", { name: controls.name })}
          onClose={() => setAnchor(null)}
          items={containerMenuItems(controls)}
        />
      )}
    </>
  );
}
