import { common, createLowlight } from "lowlight";

// One grammar registry for editable code, reading and exported pages.
const lowlight = createLowlight(common);

export const codeLanguages = lowlight.listLanguages();

export function normalizeCodeLanguage(language?: string | null): string {
  return language?.trim().toLowerCase().split(/\s+/)[0] || "plaintext";
}

export function supportsCodeLanguage(language?: string | null): boolean {
  return lowlight.registered(normalizeCodeLanguage(language));
}

type Tokens = ReturnType<typeof lowlight.highlight>["children"];

// ProseMirror decorations are flat. Give each leaf its nearest syntax scope so
// nested expressions (e.g. keywords inside template strings) get the same color
// in the editor and reader, without inheriting conflicting outer token classes.
function flattenTokens(nodes: Tokens, classes: string[] = []): Tokens {
  return nodes.flatMap((node): Tokens => {
    if (node.type === "text") {
      return classes.length
        ? [
            {
              type: "element",
              tagName: "span",
              properties: { className: classes },
              children: [node],
            },
          ]
        : [node];
    }
    if (node.type !== "element") return [];
    const own = node.properties.className;
    return flattenTokens(
      node.children,
      Array.isArray(own) && own.length ? own.map(String) : classes,
    );
  });
}

export function highlightCode(code: string, language?: string | null) {
  const name = normalizeCodeLanguage(language);
  const tree = lowlight.highlight(
    lowlight.registered(name) ? name : "plaintext",
    code,
  );
  return { ...tree, children: flattenTokens(tree.children) };
}

// Tiptap normally guesses the language for missing/unknown labels. Keep those
// blocks plain, just like the reader, and resolve aliases/case in one place.
export const codeHighlighter = {
  listLanguages: () => codeLanguages,
  registered: supportsCodeLanguage,
  highlight: (language: string, code: string) => highlightCode(code, language),
  highlightAuto: (code: string) => highlightCode(code),
};
