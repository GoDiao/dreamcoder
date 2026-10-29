import type { BlockProps } from "./types";
import { RichText } from "../rich-text/RichText";
import { primitiveContentNode } from "../rich-text/model.mjs";
import { validatePrimitiveData } from "./primitive-contract.mjs";
export { validatePrimitiveData };
export { RichText as TextBlock } from "../rich-text/RichText";

/** Compatibility entrypoints use the same content tree, editor and reader as Pages. */
function ContentBlock({
  kind,
  data,
  onChange,
  readOnly,
}: BlockProps & { kind: string }) {
  validatePrimitiveData(kind, data);
  const node = data.document ? undefined : primitiveContentNode(kind, data);
  return (
    <RichText
      data={{
        content: data.document ?? { type: "doc", content: node ? [node] : [] },
        format: "richtext",
      }}
      readOnly={readOnly}
      onChange={
        onChange
          ? (next) => {
              onChange({ document: next.content });
            }
          : undefined
      }
    />
  );
}
export const ImageBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="image" />
);
export const TableBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="table" />
);
export const CodeBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="code" />
);
export const CalloutBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="callout" />
);
export const ToggleBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="toggle" />
);
export const StepperBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="stepper" />
);
export const DividerBlock = (props: BlockProps) => (
  <ContentBlock {...props} kind="divider" />
);
