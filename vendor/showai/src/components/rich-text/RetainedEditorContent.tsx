import { PureEditorContent } from "@tiptap/react";

/** Activity retains a connected view. Container navigation instead removes its
 * old host and mounts a new one for the same pooled Editor: transfer the live
 * view and its React node-view portals before the old host's deferred cleanup.
 */
export class RetainedEditorContent extends PureEditorContent {
  init() {
    const editor = this.props.editor;
    const host = this.editorContentRef.current as HTMLElement | null;
    // contentComponent belongs to Tiptap React's EditorContent integration.
    // PureEditorContent.init returns early while it exists; a retained editor
    // therefore needs an explicit host handoff rather than a second init.
    const mounted = editor as typeof editor & { contentComponent?: unknown };
    if (editor && !editor.isDestroyed && host && mounted?.contentComponent) {
      const owner = editor.view.dom.parentElement;
      if (owner && owner !== host) {
        if (owner.isConnected)
          throw new Error(
            "A retained editor cannot occupy two connected hosts.",
          );
        host.append(...owner.childNodes);
        editor.setOptions({ element: host });
      }
      return;
    }
    super.init();
  }

  componentWillUnmount() {
    const host = this.editorContentRef.current as HTMLElement | null;
    const editor = this.props.editor;
    queueMicrotask(() => {
      // A replacement host may already own this same editor. The retired
      // component must not detach its view or destroy its live node views.
      if (host && !host.isConnected && editor?.options.element === host)
        super.componentWillUnmount();
    });
  }
}
