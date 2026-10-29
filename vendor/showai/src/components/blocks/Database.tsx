import { BlockItemSources, BlockSettings } from "./action-host";
import ExpandableSearch from "../ExpandableSearch";
import { useContext, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  Download,
  ExternalLink,
  Filter,
  LayoutDashboard,
  LayoutList,
  Plus,
  Table2,
  Trash2,
} from "../../ui/icons";
import {
  downloadFile,
  filterSortRows,
  safeUrl,
  text,
  toCsv,
  uid,
} from "./helpers";
import { BlockHeader, EmptyState, Field, blockLabel } from "./shared";
import {
  DatabaseCalendar,
  pruneCalendarConfig,
  resolveCalendar,
} from "./DatabaseCalendar";
import { normalizeDate } from "./database-contract.mjs";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import type {
  BlockProps,
  ColumnType,
  DatabaseCalendarConfig,
  DatabaseColumn,
  DatabaseRow,
} from "./types";
import {
  isIndex,
  isRecord,
  isText,
  useReaderState,
} from "../../surface/reader-state";

const TYPES: { value: ColumnType; label: MessageKey<typeof messages> }[] = [
  { value: "text", label: "type.text" },
  { value: "number", label: "type.number" },
  { value: "select", label: "type.select" },
  { value: "checkbox", label: "type.checkbox" },
  { value: "url", label: "type.url" },
  { value: "date", label: "type.date" },
];
type View = "table" | "board" | "calendar";
const VIEWS: View[] = ["table", "board", "calendar"];
const TYPE_SYMBOL: Record<ColumnType, string> = {
  text: "Aa",
  number: "#",
  select: "◉",
  checkbox: "☑",
  url: "↗",
  date: "◫",
};

function Cell({
  row,
  column,
  editable,
  update,
}: {
  row: DatabaseRow;
  column: DatabaseColumn;
  editable: boolean;
  update: (value: string | number | boolean) => void;
}) {
  const t = useTranslator(messages);
  const value = row[column.id];
  if (column.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={column.name}
        checked={Boolean(value)}
        disabled={!editable}
        onChange={(event) => update(event.target.checked)}
      />
    );
  if (!editable) {
    if (column.type === "select" && value)
      return (
        <span
          className={`sb-tag sb-tag-${(column.options?.indexOf(String(value)) ?? 0) % 5}`}
        >
          {text(value)}
        </span>
      );
    if (column.type === "url" && safeUrl(value))
      return (
        <a
          className="sb-cell-link"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text(value)}
          <ExternalLink size={12} />
        </a>
      );
    return (
      <span className="sb-cell-value">
        {text(value) || <span className="sb-placeholder">—</span>}
      </span>
    );
  }
  if (column.type === "select")
    return (
      <select
        aria-label={column.name}
        value={text(value)}
        className={`sb-cell-select sb-tag-${(column.options?.indexOf(String(value)) ?? 0) % 5}`}
        onChange={(event) => update(event.target.value)}
      >
        <option value="">{t("notSet")}</option>
        {column.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value && !column.options?.includes(String(value)) && (
          <option value={String(value)}>{String(value)}</option>
        )}
      </select>
    );
  return (
    <div className="sb-cell-input-wrap">
      <input
        aria-label={column.name}
        type={
          column.type === "number" || column.type === "url"
            ? column.type
            : column.type === "date"
              ? "date"
              : "text"
        }
        className="sb-cell-input"
        value={text(value)}
        placeholder={column.type === "url" ? "https://…" : "—"}
        onChange={(event) =>
          update(
            column.type === "number" && event.target.value !== ""
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {column.type === "url" && safeUrl(value) && (
        <a
          className="sb-icon-button"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("openLink", { name: column.name })}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

export function DatabaseBlock({ data, onChange, readOnly }: BlockProps) {
  const t = useTranslator(messages);
  const columns: DatabaseColumn[] = useMemo(
    () =>
      Array.isArray(data.columns)
        ? data.columns
            .filter((column) => column && typeof column.id === "string")
            .map((column) => ({
              id: column.id,
              name: text(column.name, t("property")),
              type: TYPES.some((type) => type.value === column.type)
                ? column.type
                : "text",
              options: Array.isArray(column.options)
                ? column.options.map((option: unknown) => text(option))
                : [],
            }))
        : [],
    [data.columns, t],
  );
  const rows: DatabaseRow[] = Array.isArray(data.rows)
    ? data.rows.filter((row) => row && typeof row.id === "string")
    : [];
  const [view, setView] = useReaderState<View>(
    "view",
    VIEWS.includes(data.view as View) ? (data.view as View) : "table",
    { accept: (value) => VIEWS.includes(value as View) },
  );
  // Calendar column choices are reading state seeded from the saved settings, like board grouping.
  const [calendarChoice, setCalendarChoice] =
    useReaderState<DatabaseCalendarConfig>("calendar", {}, { accept: isRecord });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useReaderState<{
    column: string;
    direction: "asc" | "desc";
  } | null>("sort", null, {
    accept: (value) =>
      value === null ||
      (isRecord(value) &&
        typeof value.column === "string" &&
        ["asc", "desc"].includes(value.direction as string)),
  });
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useReaderState(
    "filter",
    { column: "", value: "" },
    {
      accept: (value) =>
        isRecord(value) &&
        typeof value.column === "string" &&
        typeof value.value === "string",
    },
  );
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftColumns, setDraftColumns] = useState<DatabaseColumn[]>([]);
  const [error, setError] = useState("");
  const [grouping, setGrouping] = useReaderState(
    "groupBy",
    text(data.groupBy),
    { accept: isText },
  );
  const [page, setPage] = useReaderState("page", 0, { accept: isIndex });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const editable = Boolean(onChange && !readOnly);
  // Rows mapped from shared data keep their source fields and stay in the source.
  const sources = useContext(BlockItemSources);
  const cellEditable = (row: DatabaseRow, column: DatabaseColumn) =>
    editable && !sources?.get(row.id)?.readOnly.includes(column.id);
  const removable = (row: DatabaseRow) =>
    sources?.get(row.id)?.removable ?? true;
  const selectColumns = columns.filter((column) => column.type === "select");
  const groupColumn =
    columns.find(
      (column) => column.id === grouping && column.type === "select",
    ) ?? selectColumns[0];
  const shownRows = filterSortRows(rows, columns, query, filter, sort);
  const savedCalendar: DatabaseCalendarConfig =
    data.calendar && typeof data.calendar === "object"
      ? (data.calendar as DatabaseCalendarConfig)
      : {};
  const calendar = resolveCalendar(columns, {
    ...savedCalendar,
    ...calendarChoice,
  });
  const dateColumns = columns.filter((column) => column.type === "date");
  const pageSize = 30,
    totalPages = Math.max(1, Math.ceil(shownRows.length / pageSize)),
    activePage = Math.min(page, totalPages - 1);
  const options = filter.column
    ? Array.from(new Set(rows.map((row) => String(row[filter.column] ?? ""))))
    : [];
  const groupNames = groupColumn
    ? Array.from(
        new Set([
          ...(groupColumn.options ?? []),
          ...shownRows.map((row) => text(row[groupColumn.id])),
          "",
        ]),
      )
    : [""];
  const updateFields = (
    id: string,
    values: Record<string, string | number | boolean>,
  ) =>
    onChange?.({
      ...data,
      rows: rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
    });
  const updateRow = (
    id: string,
    column: string,
    value: string | number | boolean,
  ) => updateFields(id, { [column]: value });
  const addRow = (group?: string, preset: Record<string, string> = {}) => {
    const row: DatabaseRow = {
      id: uid(),
      ...Object.fromEntries(
        columns.map((column) => [
          column.id,
          column.type === "checkbox" ? false : "",
        ]),
      ),
      ...preset,
    };
    if (groupColumn && group !== undefined) row[groupColumn.id] = group;
    onChange?.({ ...data, rows: [...rows, row] });
    setPage(Math.floor(rows.length / pageSize));
    setQuery("");
    setFilter({ column: "", value: "" });
    return row.id;
  };
  const removeRow = (id: string) => {
    if (sources?.get(id)?.removable === false) return;
    onChange?.({ ...data, rows: rows.filter((row) => row.id !== id) });
  };
  const toggleSort = (column: string) => {
    setSort((current) =>
      current?.column === column
        ? current.direction === "asc"
          ? { column, direction: "desc" }
          : null
        : { column, direction: "asc" },
    );
    setPage(0);
  };
  const openEditor = () => {
    setDraftTitle(text(data.title));
    setDraftColumns(
      columns.map((column) => ({
        ...column,
        options: [...(column.options ?? [])],
      })),
    );
    setError("");
    setEditing(!editing);
  };
  const saveColumns = () => {
    if (!draftColumns.length) {
      setError(t("error.keepOneProperty"));
      return;
    }
    if (draftColumns.some((column) => !column.name.trim())) {
      setError(t("error.nameEveryProperty"));
      return;
    }
    const cleaned = draftColumns.map((column) => ({
      ...column,
      name: column.name.trim(),
      options: [
        ...new Set(
          (column.options ?? []).map((option) => option.trim()).filter(Boolean),
        ),
      ],
    }));
    const next: Record<string, unknown> = {
      ...data,
      title: draftTitle,
      columns: cleaned,
      rows: rows.map((row) =>
        sources?.has(row.id)
          ? row
          : {
              id: row.id,
              ...Object.fromEntries(
                cleaned.map((column) => {
                  const previous = row[column.id];
                  const value =
                    column.type === "checkbox"
                      ? previous === true || previous === "true"
                      : column.type === "number"
                        ? previous === "" ||
                          previous === undefined ||
                          previous === null
                          ? ""
                          : Number.isFinite(Number(previous))
                            ? Number(previous)
                            : ""
                        : column.type === "date"
                          ? normalizeDate(text(previous))
                          : text(previous);
                  return [column.id, value];
                }),
              ),
            },
      ),
    };
    // Calendar settings must keep pointing at columns of the right type.
    const calendarConfig = pruneCalendarConfig(
      data.calendar ? savedCalendar : undefined,
      cleaned,
    );
    if (calendarConfig) next.calendar = calendarConfig;
    if (
      next.view === "calendar" &&
      !cleaned.some((column) => column.type === "date")
    )
      delete next.view;
    onChange?.(next);
    setCalendarChoice({});
    if (!cleaned.some((column) => column.id === filter.column))
      setFilter({ column: "", value: "" });
    setEditing(false);
  };
  const updateDraftColumn = (id: string, changes: Partial<DatabaseColumn>) =>
    setDraftColumns((current) =>
      current.map((column) =>
        column.id === id ? { ...column, ...changes } : column,
      ),
    );
  return (
    <section
      className="sb-block sb-database"
      aria-label={blockLabel(data.title, t("database"))}
    >
      <BlockHeader
        title={text(data.title)}
        // i18n-exempt: matches the saved default title
        defaultTitle="数据库"
        icon={<Table2 size={17} />}
        editable={editable}
        editing={editing}
        onEdit={openEditor}
      >
        <button
          type="button"
          className="sb-icon-button"
          aria-label={t("exportDatabase")}
          title={t("exportCsv")}
          onClick={() =>
            downloadFile(
              toCsv(columns, shownRows),
              `${text(data.title, t("database"))}.csv`,
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={15} />
        </button>
        <details className="sb-tools-menu">
          <summary aria-label={t("viewAndFilterMenu")}>
            <Filter size={14} aria-hidden="true" />
            {t("viewAndFilter")}
          </summary>
          <div className="sb-database-toolbar">
            <div className="sb-view-tabs">
              <button
                type="button"
                className={view === "table" ? "is-active" : ""}
                onClick={() => setView("table")}
              >
                <Table2 size={14} />
                {t("table")}
              </button>
              <button
                type="button"
                className={view === "board" ? "is-active" : ""}
                onClick={() => setView("board")}
              >
                <Columns3 size={14} />
                {t("board")}
              </button>
              <button
                type="button"
                className={view === "calendar" ? "is-active" : ""}
                onClick={() => setView("calendar")}
              >
                <LayoutDashboard size={14} />
                {t("calendar")}
              </button>
            </div>
            <div className="sb-database-tools">
              <ExpandableSearch
                label={t("searchDatabase")}
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(0);
                }}
              />
              <button
                type="button"
                className={`sb-icon-button ${showFilter || filter.column ? "is-active" : ""}`}
                aria-label={t("filterDatabase")}
                onClick={() => setShowFilter(!showFilter)}
              >
                <Filter size={15} />
              </button>
              {editable && (
                <button
                  type="button"
                  className="sb-button sb-primary sb-small"
                  onClick={() => addRow()}
                >
                  <Plus size={14} />
                  {t("newRecord")}
                </button>
              )}
            </div>
            {view === "board" && selectColumns.length > 0 && (
              <div className="sb-board-grouping">
                <span>{t("groupBy")}</span>
                <select
                  aria-label={t("boardGroupProperty")}
                  value={groupColumn?.id ?? ""}
                  onChange={(event) => setGrouping(event.target.value)}
                >
                  {selectColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view === "calendar" && calendar.dateColumn && (
              <div className="sb-board-grouping sb-calendar-settings">
                {(
                  [
                    ["dateColumn", "calendar.dateProperty", dateColumns, false],
                    [
                      "endDateColumn",
                      "calendar.endDateProperty",
                      dateColumns.filter(
                        (column) => column.id !== calendar.dateColumn?.id,
                      ),
                      true,
                    ],
                    [
                      "colorColumn",
                      "calendar.colorProperty",
                      selectColumns,
                      true,
                    ],
                    [
                      "doneColumn",
                      "calendar.doneProperty",
                      columns.filter((column) => column.type === "checkbox"),
                      true,
                    ],
                  ] as const
                ).map(([key, label, choices, optional]) =>
                  choices.length > (optional ? 0 : 1) ? (
                    <label key={key}>
                      <span>{t(label)}</span>
                      <select
                        value={calendar[key]?.id ?? ""}
                        onChange={(event) =>
                          setCalendarChoice((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        {optional && (
                          <option value="">{t("calendar.none")}</option>
                        )}
                        {choices.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </details>
      </BlockHeader>
      {editing && (
        <BlockSettings>
          <div className="sb-editor-panel">
            <Field label={t("databaseName")}>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </Field>
            <div className="sb-property-list">
              {draftColumns.map((column) => (
                <div className="sb-property-row" key={column.id}>
                  <input
                    aria-label={t("propertyName")}
                    value={column.name}
                    onChange={(event) =>
                      updateDraftColumn(column.id, { name: event.target.value })
                    }
                  />
                  <select
                    aria-label={t("propertyType", { name: column.name })}
                    value={column.type}
                    onChange={(event) =>
                      updateDraftColumn(column.id, {
                        type: event.target.value as ColumnType,
                      })
                    }
                  >
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {t(type.label)}
                      </option>
                    ))}
                  </select>
                  {column.type === "select" && (
                    <input
                      className="sb-options-input"
                      aria-label={t("propertyOptions", { name: column.name })}
                      placeholder={t("optionsPlaceholder")}
                      value={column.options?.join(",")}
                      onChange={(event) =>
                        updateDraftColumn(column.id, {
                          options: event.target.value.split(/[,，]/),
                        })
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="sb-icon-button sb-danger"
                    aria-label={t("deleteProperty", { name: column.name })}
                    onClick={() =>
                      setDraftColumns((current) =>
                        current.filter((item) => item.id !== column.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className="sb-error">
                {error}
              </p>
            )}
            <div className="sb-panel-footer">
              <button
                type="button"
                className="sb-button"
                onClick={() =>
                  setDraftColumns((current) => [
                    ...current,
                    // i18n-exempt: default property name saved into the document
                    { id: uid(), name: "新属性", type: "text" },
                  ])
                }
              >
                <Plus size={14} />
                {t("addProperty")}
              </button>
              <button
                type="button"
                className="sb-button sb-primary"
                onClick={saveColumns}
              >
                <Check size={14} />
                {t("saveProperties")}
              </button>
            </div>
          </div>
        </BlockSettings>
      )}
      {showFilter && (
        <div className="sb-filter-row">
          <Filter size={13} />
          <select
            aria-label={t("filterProperty")}
            value={filter.column}
            onChange={(event) => {
              const column = event.target.value;
              setFilter({
                column,
                value: column ? String(rows[0]?.[column] ?? "") : "",
              });
              setPage(0);
            }}
          >
            <option value="">{t("allRecords")}</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
          {filter.column && (
            <>
              <span>{t("equals")}</span>
              <select
                aria-label={t("filterValue")}
                value={filter.value}
                onChange={(event) => {
                  setFilter((current) => ({
                    ...current,
                    value: event.target.value,
                  }));
                  setPage(0);
                }}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option || t("notSet")}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sb-text-button"
                onClick={() => setFilter({ column: "", value: "" })}
              >
                {t("clear")}
              </button>
            </>
          )}
        </div>
      )}
      {view === "calendar" ? (
        <DatabaseCalendar
          key={JSON.stringify(savedCalendar)}
          columns={columns}
          rows={shownRows}
          settings={calendar}
          editable={editable}
          renderCell={(row, column) => (
            <Cell
              row={row}
              column={column}
              editable={cellEditable(row, column)}
              update={(value) => updateRow(row.id, column.id, value)}
            />
          )}
          onMove={(id, start, end) =>
            updateFields(id, {
              [calendar.dateColumn!.id]: start,
              ...(end && calendar.endDateColumn
                ? { [calendar.endDateColumn.id]: end }
                : {}),
            })
          }
          onAdd={
            calendar.dateColumn
              ? (date) => addRow(undefined, { [calendar.dateColumn!.id]: date })
              : undefined
          }
          onRemove={removeRow}
        />
      ) : view === "table" ? (
        <>
          <div className="sb-table-scroll">
            <table className="sb-database-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.id}>
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                      >
                        <span className="sb-type-symbol">
                          {TYPE_SYMBOL[column.type]}
                        </span>
                        {column.name}
                        {sort?.column === column.id &&
                          (sort.direction === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          ))}
                      </button>
                    </th>
                  ))}
                  {editable && (
                    <th
                      className="sb-row-action"
                      aria-label={t("rowActions")}
                    />
                  )}
                </tr>
              </thead>
              <tbody>
                {shownRows
                  .slice(activePage * pageSize, (activePage + 1) * pageSize)
                  .map((row) => (
                    <tr key={row.id} title={sources?.get(row.id)?.label}>
                      {columns.map((column) => (
                        <td key={column.id}>
                          <Cell
                            row={row}
                            column={column}
                            editable={cellEditable(row, column)}
                            update={(value) =>
                              updateRow(row.id, column.id, value)
                            }
                          />
                        </td>
                      ))}
                      {editable && (
                        <td className="sb-row-action">
                          {removable(row) && (
                            <button
                              type="button"
                              className="sb-icon-button sb-danger"
                              aria-label={t("deleteNamedRecord", {
                                name: text(row[columns[0]?.id]),
                              })}
                              onClick={() => removeRow(row.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {shownRows.length === 0 && (
            <EmptyState
              icon={<LayoutList size={25} strokeWidth={1.4} />}
              title={rows.length ? t("empty.noMatches") : t("empty.start")}
            />
          )}
        </>
      ) : (
        <>
          <div className="sb-board">
            {groupNames.map((group, groupIndex) => {
              const groupRows = groupColumn
                ? shownRows.filter((row) => text(row[groupColumn.id]) === group)
                : shownRows;
              return (
                <div
                  className={`sb-board-column ${draggingId ? "is-droppable" : ""}`}
                  key={group}
                  onDragOver={(event) => {
                    if (editable && groupColumn && draggingId)
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (!editable || !groupColumn || !draggingId) return;
                    event.preventDefault();
                    updateRow(draggingId, groupColumn.id, group);
                    setDraggingId(null);
                  }}
                >
                  <div className="sb-board-column-header">
                    <span className={`sb-tag sb-tag-${groupIndex % 5}`}>
                      {group || (groupColumn ? t("notSet") : t("allRecords"))}
                    </span>
                    <span>{groupRows.length}</span>
                    {editable && (
                      <button
                        type="button"
                        className="sb-icon-button"
                        aria-label={t("newRecordIn", {
                          group: group || t("notSet"),
                        })}
                        onClick={() => addRow(group)}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                  {groupRows.map((row) => (
                    <div
                      className={`sb-board-card ${draggingId === row.id ? "is-dragging" : ""}`}
                      key={row.id}
                      draggable={editable && Boolean(groupColumn)}
                      onDragStart={() => setDraggingId(row.id)}
                      onDragEnd={() => setDraggingId(null)}
                    >
                      {columns
                        .filter((column) => column.id !== groupColumn?.id)
                        .map((column, index) => (
                          <div
                            key={column.id}
                            className={
                              index === 0
                                ? "sb-board-card-title"
                                : "sb-board-card-field"
                            }
                          >
                            {index > 0 && <span>{column.name}</span>}
                            <Cell
                              row={row}
                              column={column}
                              editable={cellEditable(row, column)}
                              update={(value) =>
                                updateRow(row.id, column.id, value)
                              }
                            />
                          </div>
                        ))}
                      {editable && (
                        <div className="sb-board-card-footer">
                          {groupColumn && (
                            <select
                              aria-label={t("moveToGroup")}
                              value={text(row[groupColumn.id])}
                              onChange={(event) =>
                                updateRow(
                                  row.id,
                                  groupColumn.id,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">{t("notSet")}</option>
                              {groupNames.filter(Boolean).map((name) => (
                                <option key={name}>{name}</option>
                              ))}
                            </select>
                          )}
                          {removable(row) && (
                            <button
                              type="button"
                              className="sb-icon-button sb-danger"
                              aria-label={t("deleteRecord")}
                              onClick={() => removeRow(row.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {editable && (
                    <button
                      type="button"
                      className="sb-add-row"
                      onClick={() => addRow(group)}
                    >
                      <Plus size={13} />
                      {t("addRecord")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="sb-database-footer">
        <span>
          {shownRows.length === rows.length
            ? t("recordCount", { count: rows.length })
            : t("filteredRecordCount", {
                shown: shownRows.length,
                count: rows.length,
              })}
          {sort && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() => setSort(null)}
            >
              {t("clearSort")}
            </button>
          )}
        </span>
        {view === "table" && totalPages > 1 && (
          <div className="sb-pagination">
            <button
              type="button"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              {t("previousPage")}
            </button>
            <span>
              {activePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={activePage + 1 === totalPages}
              onClick={() => setPage(activePage + 1)}
            >
              {t("nextPage")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
