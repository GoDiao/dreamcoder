import { AlignCenter, AlignLeft, AlignRight } from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/blockHelpers";

export type TableAlignment = "left" | "center" | "right";

/**
 * "table" for the whole table, a zero-based column index for one column. Any
 * other string is an already translated scope name.
 */
export type AlignmentScope = "table" | number | string;

const alignments = [
  ["left", "Left", AlignLeft],
  ["center", "Center", AlignCenter],
  ["right", "Right", AlignRight],
] as const;

export function AlignmentButtons({
  scope,
  value,
  onChange,
}: {
  scope: AlignmentScope;
  value: string | null;
  onChange: (alignment: TableAlignment) => void;
}) {
  const t = useTranslator(messages);
  const label = (suffix: "Group" | "Left" | "Center" | "Right") =>
    scope === "table"
      ? t(`align.table${suffix}`)
      : typeof scope === "number"
        ? t(`align.column${suffix}`, { column: scope + 1 })
        : t(`align.scope${suffix}`, { scope });
  return (
    <div
      className="table-alignment-buttons"
      role="group"
      aria-label={label("Group")}
    >
      {alignments.map(([alignment, suffix, Icon]) => (
        <button
          key={alignment}
          type="button"
          aria-label={label(suffix)}
          title={label(suffix)}
          aria-pressed={value === alignment}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onChange(alignment);
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
