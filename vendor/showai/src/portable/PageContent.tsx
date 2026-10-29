import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { Widget } from "../components/blocks/Widget";
import {
  RichTextNode,
  RichTextContent,
} from "../components/rich-text/RichTextView";
export function PageNode({ node }: { node: JSONContent }) {
  return (
    <RichTextNode
      node={node}
      renderWidget={(kind, data) => <ReadingWidget kind={kind} data={data} />}
    />
  );
}
export function PageContent({
  content,
  data,
}: {
  content: JSONContent;
  data?: Record<string, unknown>;
}) {
  return (
    <RichTextContent
      content={content}
      data={data}
      renderWidget={(kind, data) => <ReadingWidget kind={kind} data={data} />}
    />
  );
}

/** Editing is confined to the explicitly requested preview, never the stored Page. */
function ReadingWidget({
  kind,
  data,
}: {
  kind: string;
  data: Record<string, unknown>;
}) {
  const [local, setLocal] = useState(data);
  useEffect(() => setLocal(data), [data]);
  const options =
    typeof window === "undefined"
      ? undefined
      : window.document.querySelector(
          'script#showai-read-options[type="application/json"]',
        )?.textContent;
  const draft = options ? JSON.parse(options).draft === true : false;
  return (
    <Widget
      kind={kind}
      data={local}
      readOnly={!draft}
      onChange={draft ? setLocal : undefined}
    />
  );
}
