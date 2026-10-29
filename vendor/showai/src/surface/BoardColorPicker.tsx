import { useRef } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

const colors = [
  "#252629",
  "#697586",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function BoardColorPicker({
  value,
  label,
  onChange,
  allowNone = false,
}: {
  allowNone?: boolean;
  value: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const t = useTranslator(messages),
    menu = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={menu} className="board-color-picker">
      <summary
        aria-label={label}
        title={label}
        data-empty={value === "none" || undefined}
        style={{ backgroundColor: value === "none" ? "#ffffff" : value }}
      />
      <div className="board-color-menu" data-surface-ui>
        <div
          className="board-color-presets"
          role="group"
          aria-label={t("style.presets")}
        >
          {allowNone && (
            <button
              type="button"
              className="board-color-empty"
              aria-label={t("style.none")}
              title={t("style.none")}
              aria-pressed={value === "none"}
              onClick={() => {
                onChange("none");
                if (menu.current) menu.current.open = false;
              }}
            />
          )}
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={t("style.presetColor", { color })}
              aria-pressed={value.toLowerCase() === color}
              style={{ backgroundColor: color }}
              onClick={() => {
                onChange(color);
                if (menu.current) menu.current.open = false;
              }}
            />
          ))}
        </div>
        <label className="board-full-palette">
          {t("style.fullPalette")}
          <input
            type="color"
            aria-label={label}
            value={value === "none" ? "#ffffff" : value}
            onInput={(event) => onChange(event.currentTarget.value)}
          />
        </label>
      </div>
    </details>
  );
}
