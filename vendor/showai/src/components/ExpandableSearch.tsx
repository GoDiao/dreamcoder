import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Search, X } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/search";
import "./expandable-search.css";

/** A search action that expands in the toolbar's normal layout flow. */
export default function ExpandableSearch({
  label,
  placeholder = label,
  value,
  onChange,
  children,
  defaultExpanded = false,
  inputRef,
  onKeyDown,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
  defaultExpanded?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const t = useTranslator(messages);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [engaged, setEngaged] = useState(false);
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = expanded || !!value;
  useLayoutEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);
  function close() {
    onChange("");
    setExpanded(false);
    setEngaged(false);
    trigger.current?.focus();
  }
  return (
    <div
      className={`expandable-search${open ? " is-expanded" : ""}`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setEngaged(false);
        if (!value) setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          // Dialogs also listen on document, outside React's event delegation.
          event.nativeEvent.stopImmediatePropagation();
          close();
          return;
        }
        onKeyDown?.(event);
      }}
    >
      <div className="expandable-search-field">
        <button
          ref={trigger}
          type="button"
          className="expandable-search-trigger"
          aria-label={label}
          title={label}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setExpanded(true);
            setEngaged(true);
            input.current?.focus();
          }}
        >
          <Search size={16} />
        </button>
        <input
          ref={input}
          id={id}
          type="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          tabIndex={open ? 0 : -1}
          disabled={!open}
          onFocus={() => setEngaged(true)}
          onChange={(event) => onChange(event.target.value)}
        />
        {open && (
          <button
            type="button"
            className="expandable-search-close"
            aria-label={t("collapseSearch", { label })}
            title={t("clearAndCollapseSearch")}
            onClick={close}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && engaged && children && (
        <div className="expandable-search-results">{children}</div>
      )}
    </div>
  );
}
