import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { findChildren } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { codeHighlighter } from "./code-highlighting";
import "./code-highlighting.css";

export const HighlightedCodeBlock = CodeBlockLowlight.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map((plugin) => {
      const field = plugin.spec.state;
      if (!field || !plugin.props.decorations) return plugin;
      const name = this.name;
      return new Plugin({
        ...plugin.spec,
        state: {
          ...field,
          apply(transaction, decorations, oldState, newState) {
            if (transaction.docChanged) {
              const before = findChildren(
                oldState.doc,
                (node) => node.type.name === name,
              );
              const after = findChildren(
                newState.doc,
                (node) => node.type.name === name,
              );
              // The upstream plugin only refreshes selected or replaced blocks.
              // AttrStep (language menu) and edits from agents can affect other
              // blocks too. Compare code nodes, ignoring selection and position.
              if (
                before.length !== after.length ||
                after.some((block, index) => !block.node.eq(before[index].node))
              ) {
                return field.init.call(this, {}, newState);
              }
            }
            return decorations.map(transaction.mapping, transaction.doc);
          },
        },
      });
    });
  },
}).configure({
  lowlight: codeHighlighter,
  HTMLAttributes: { class: "code-block" },
});
