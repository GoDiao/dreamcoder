import { Settings2, X } from "../../ui/icons";
import { useContext, useLayoutEffect, type ReactNode } from "react";
import { BlockActions, BlockActionHost } from "./action-host";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/blocks";
import { NoteText } from "./NoteText";
import { plainNotes } from "./note-markup.mjs";

// Default titles that built-in components save into documents; a caption that
// still matches one of them is hidden.
const genericTitles = new Set(
  [
    "数据图表|数据库|关键指标|交互计算|图片画廊|交互流程图|思维导图|G2 图表|图表", // i18n-exempt: saved default titles
    "柱状图|折线图|面积图|散点图|气泡图|分组柱状图|双向条形图|雷达图|径向条形图|平行坐标|回归曲线", // i18n-exempt: saved default titles
    "饼图|环图|堆叠柱状图|堆叠面积图|玫瑰图|马赛克图|矩形树图|旭日图|漏斗图", // i18n-exempt: saved default titles
    "直方图|箱线图|小提琴图|分布曲线|密度热力图|色块图|等高线图|茎叶图", // i18n-exempt: saved default titles
    "桑基图|弦图|弧图|圆形打包图|韦恩图|甘特图|K 线图|Kagi 转向图|螺旋图", // i18n-exempt: saved default titles
    "分级设色地图|点地图|气泡地图|仪表盘|子弹图|词云", // i18n-exempt: saved default titles
  ]
    .join("|")
    .split("|"),
);

/** Accessible name: the block's own title, or a translated label while it still has a saved default. */
export function blockLabel(title: unknown, fallback: string): string {
  return typeof title === "string" &&
    title.trim() &&
    !genericTitles.has(title.trim())
    ? plainNotes(title)
    : fallback;
}

export function BlockHeader({
  title,
  defaultTitle,
  description,
  editable,
  editing,
  onEdit,
  children,
}: {
  title?: string;
  defaultTitle?: string;
  description?: string;
  icon?: ReactNode;
  editable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslator(messages);
  const host = useContext(BlockActionHost);
  useLayoutEffect(() => {
    if (!host || !editing || !onEdit) return;
    host.closeSettings = onEdit;
    return () => {
      if (host.closeSettings === onEdit) delete host.closeSettings;
    };
  }, [host, editing, onEdit]);
  const caption = title?.trim();

  const visibleTitle =
    caption && caption !== defaultTitle && !genericTitles.has(caption)
      ? caption
      : "";
  const hasCaption = Boolean(visibleTitle || description?.trim());
  if (!hasCaption && !children && !editable) return null;
  return (
    <div
      className={`sb-header${hasCaption ? " has-caption" : ""}${editing ? " is-editing" : ""}`}
    >
      {hasCaption && (
        <div className="sb-heading">
          {visibleTitle && (
            <div className="sb-title">
              <NoteText text={visibleTitle} />
            </div>
          )}
          {description?.trim() && (
            <p className="sb-description">
              <NoteText text={description} />
            </p>
          )}
        </div>
      )}
      {(children || editable) && (
        <BlockActions>
          <div
            className="sb-actions"
            role="group"
            aria-label={t("blockActions")}
          >
            {children}
            {editable && (
              <button
                type="button"
                className={`sb-icon-button ${editing ? "is-active" : ""}`}
                onClick={onEdit}
                aria-label={editing ? t("closeSettings") : t("editBlock")}
                title={editing ? t("closeSettings") : t("editBlock")}
              >
                {editing ? <X size={16} /> : <Settings2 size={16} />}
              </button>
            )}
          </div>
        </BlockActions>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sb-empty">
      {icon}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`sb-field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
