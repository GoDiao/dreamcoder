import { Editor, type EditorOptions } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import type { ResolvedPos, Node } from "@tiptap/pm/model";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";

interface CursorAnchor {
  id?: string;
  offset: number;
  position: number;
}
interface EditorCursor {
  json: ReturnType<Selection["toJSON"]>;
  anchor: CursorAnchor;
  head: CursorAnchor;
  nodeId?: string;
}
export interface WorkspaceEditorState {
  focused?: string;
  cursors: Map<string, EditorCursor>;
}
const anchor = (position: ResolvedPos): CursorAnchor => {
  for (let depth = position.depth; depth > 0; depth--) {
    const id = position.node(depth).attrs.id;
    if (typeof id === "string")
      return {
        id,
        offset: position.pos - position.start(depth),
        position: position.pos,
      };
  }
  return { position: position.pos, offset: 0 };
};
function locate(document: Node, saved: CursorAnchor) {
  let position: number | undefined;
  if (saved.id)
    document.descendants((node, start) => {
      if (node.attrs.id === saved.id)
        position = start + 1 + Math.min(saved.offset, node.content.size);
      return position === undefined;
    });
  return position ?? Math.min(saved.position, document.content.size);
}
const restoredSelections = new WeakSet<Editor>();
export const hasRetainedSelection = (editor: Editor) =>
  restoredSelections.has(editor);

/** Activity disconnects effects; the view owner retains ProseMirror's state. */
export class WorkspaceEditors {
  private editors = new Map<string, Editor>();
  constructor(
    private readonly state: WorkspaceEditorState = { cursors: new Map() },
  ) {}
  find(key: string) {
    const editor = this.editors.get(key);
    return editor && !editor.isDestroyed ? editor : null;
  }
  get(key: string, create: () => Editor) {
    const existing = this.find(key);
    if (existing) return existing;
    const editor = create();
    const saved = this.state.cursors.get(key);
    if (saved) {
      try {
        const json = { ...saved.json };
        if (json.type === "text") {
          json.anchor = locate(editor.state.doc, saved.anchor);
          json.head = locate(editor.state.doc, saved.head);
        } else if (json.type === "node" && saved.nodeId) {
          editor.state.doc.descendants((node, position) => {
            if (node.attrs.id === saved.nodeId) json.anchor = position;
          });
        }
        editor.view.dispatch(
          editor.state.tr
            .setSelection(Selection.fromJSON(editor.state.doc, json))
            .setMeta("addToHistory", false),
        );
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        editor.view.dispatch(
          editor.state.tr
            .setSelection(
              TextSelection.near(
                editor.state.doc.resolve(locate(editor.state.doc, saved.head)),
              ),
            )
            .setMeta("addToHistory", false),
        );
      }
      restoredSelections.add(editor);
    }
    this.editors.set(key, editor);
    editor.on("focus", () => {
      this.state.focused = key;
    });
    editor.on("transaction", () => {
      const selection = editor.state.selection;
      this.state.cursors.set(key, {
        json: selection.toJSON(),
        anchor: anchor(selection.$anchor),
        head: anchor(selection.$head),
        nodeId:
          selection instanceof NodeSelection
            ? selection.node.attrs.id
            : undefined,
      });
    });
    return editor;
  }
  dispose() {
    for (const editor of this.editors.values())
      if (!editor.isDestroyed) editor.destroy();
    this.editors.clear();
  }
  restoreFocus() {
    const editor = this.state.focused ? this.find(this.state.focused) : null;
    if (editor?.isEditable && editor.view.dom.isConnected)
      editor.view.dom.focus({ preventScroll: true });
  }
}
export const WorkspaceEditorContext = createContext<WorkspaceEditors | null>(
  null,
);

// A pooled Editor can outlive the hook instance that first created it. Its
// stable event/DOM proxies dispatch through the currently mounted view owner,
// rather than retaining that first component's content-range closures.
const editorOwners = new WeakMap<
  Editor,
  { readonly current: Partial<EditorOptions> }
>();

export function useWorkspaceEditor(
  options: Partial<EditorOptions> & {
    retentionKey?: string;
    immediatelyRender?: boolean;
    shouldRerenderOnTransaction?: boolean;
  },
) {
  const pool = useContext(WorkspaceEditorContext);
  const localId = useId();
  const key = useRef(options.retentionKey ?? localId).current;
  const latest = useRef(options);
  latest.current = options;
  const instance = useRef<Editor | null>(pool?.find(key) ?? null);
  const [editor, setEditor] = useState(instance.current);
  const destruction = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    clearTimeout(destruction.current);
    const create = () => {
      const {
        retentionKey: _key,
        immediatelyRender: _render,
        shouldRerenderOnTransaction: _rerender,
        ...initial
      } = latest.current;
      let created: Editor;
      created = new Editor({
        ...initial,
        onUpdate: (event) =>
          editorOwners.get(event.editor)?.current.onUpdate?.(event),
        editorProps: {
          ...initial.editorProps,
          handleKeyDown: (view, event) =>
            editorOwners
              .get(created)
              ?.current.editorProps?.handleKeyDown?.(view, event) ?? false,
          handleClick: (view, position, event) =>
            editorOwners
              .get(created)
              ?.current.editorProps?.handleClick?.(view, position, event) ??
            false,
          handlePaste: (view, event, slice) =>
            editorOwners
              .get(created)
              ?.current.editorProps?.handlePaste?.(view, event, slice) ?? false,
        },
      });
      return created;
    };
    const next = pool
      ? pool.get(key, create)
      : instance.current && !instance.current.isDestroyed
        ? instance.current
        : create();
    instance.current = next;
    editorOwners.set(next, latest);
    next.setEditable(latest.current.editable !== false, false);
    setEditor(next);
    return () => {
      if (editorOwners.get(next) === latest) {
        editorOwners.delete(next);
        if (!next.isDestroyed) next.setEditable(false, false);
      }
      if (pool) return;
      // React's effect replay must not destroy a still-mounted editor.
      destruction.current = setTimeout(() => {
        if (instance.current === next && !next.isDestroyed) next.destroy();
      }, 1);
    };
  }, [pool, key]);
  return editor;
}
