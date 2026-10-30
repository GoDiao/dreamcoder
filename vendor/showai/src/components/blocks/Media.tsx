import { useState } from "react";
import { FileText, Music2, Video } from "../../ui/icons";
import { safeImageUrl, text } from "./helpers";
import { safeResourceUrl } from "./research-contract.mjs";
import { BlockHeader, EmptyState, blockLabel } from "./shared";
import { ResourceEditor } from "./ResourceEditor";
import type { BlockProps } from "./types";
import "./research-media.css";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/media";

function MediaBlock({
  kind,
  data,
  onChange,
  readOnly,
}: BlockProps & { kind: "video" | "audio" }) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState("");
  const editable = Boolean(onChange && !readOnly);
  const src = safeResourceUrl(kind, data.src);
  const label = kind === "video" ? t("video") : t("audio");
  const Icon = kind === "video" ? Video : Music2;
  return (
    <section
      className={`sb-block sb-media sb-${kind}`}
      aria-label={blockLabel(data.title, label)}
    >
      {(kind === "audio" || !src) && (
        <BlockHeader
          editable={editable}
          editing={editing}
          onEdit={() => setEditing(!editing)}
        />
      )}
      {editing && (
        <ResourceEditor
          kind={kind}
          data={data}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onChange?.(next);
            setEditing(false);
            setFailed("");
          }}
        />
      )}
      {src ? (
        <figure className="sb-media-figure">
          {kind === "video" ? (
            <div className="sb-video-stage" data-surface-gesture="own">
              <BlockHeader
                title={text(data.title)}
                defaultTitle={label}
                editable={editable}
                editing={editing}
                onEdit={() => setEditing(!editing)}
              />
              <video
                key={src}
                controls
                playsInline
                preload="metadata"
                poster={safeImageUrl(data.poster)}
                loop={data.loop === true}
                muted={data.muted === true}
                style={{
                  aspectRatio: text(data.aspectRatio, "16:9").replace(
                    ":",
                    " / ",
                  ),
                }}
                src={src}
                aria-label={blockLabel(data.title, t("videoPlayer"))}
                onError={() => setFailed(src)}
              />
            </div>
          ) : (
            <div className="sb-audio-body" data-surface-gesture="own">
              <div className="sb-audio-icon">
                <Music2 size={20} />
              </div>
              <div className="sb-audio-track">
                <div className="sb-audio-name">
                  {text(data.title) || text(data.fileName) || t("audio")}
                </div>
                <audio
                  key={src}
                  controls
                  preload="metadata"
                  src={src}
                  loop={data.loop === true}
                  aria-label={blockLabel(data.title, t("audioPlayer"))}
                  onError={() => setFailed(src)}
                />
              </div>
            </div>
          )}
          {failed === src && (
            <p className="sb-error" role="alert">
              {t("playFailed")}{" "}
              <a
                href={src}
                download={text(data.fileName) || undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("openOriginal")}
              </a>
            </p>
          )}
          {text(data.caption) && (
            <figcaption className="sb-resource-caption">
              {text(data.caption)}
            </figcaption>
          )}
        </figure>
      ) : (
        <EmptyState
          icon={<Icon size={28} strokeWidth={1.4} />}
          title={kind === "video" ? t("addVideo") : t("addAudio")}
          description={t("emptyDescription")}
          action={
            editable && !editing ? (
              <button
                type="button"
                className="sb-button"
                onClick={() => setEditing(true)}
              >
                <FileText size={14} />
                {t("chooseFile")}
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
export const VideoBlock = (props: BlockProps) => (
  <MediaBlock {...props} kind="video" />
);
export const AudioBlock = (props: BlockProps) => (
  <MediaBlock {...props} kind="audio" />
);
