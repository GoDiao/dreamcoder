import type { CSSProperties, ReactNode } from "react";
import type { BlockProps } from "./types";
import {
  CARD_TONES,
  cardGridColumns,
  isExternalHref,
  isSafeHref,
  type CardGridData,
} from "./doc-browse-contract.mjs";
import { InlineMarkup as InlineText } from "./InlineMarkup";
import "./card-grid.css";
import { blockLabel } from "./shared";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/cardGrid";
import { NoteText } from "./NoteText";

type Card = CardGridData["cards"][number];

const Arrow = () => (
  <svg className="cg-arrow" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8h9M8.5 4l4 4-4 4" />
  </svg>
);

function CardContent({
  card,
  tile,
  linked,
}: {
  card: Card;
  tile: boolean;
  linked: boolean;
}) {
  // Inside a linked card, links in the body read as text so links never nest.
  const body = (
    <span className="cg-body">
      <InlineText source={card.body} links={!linked} />
    </span>
  );
  const icon = card.icon && (
    <span className="cg-icon" aria-hidden="true">
      {card.icon}
    </span>
  );
  const tag = card.tag && (
    <span className="cg-tag">
      <NoteText text={card.tag} focusable={!linked} />
    </span>
  );
  if (tile)
    return (
      <>
        {(icon || tag) && (
          <span className="cg-top">
            {icon || <span />}
            {tag}
          </span>
        )}
        <span className="cg-title">
          <span>
            <NoteText text={card.title} focusable={!linked} />
          </span>
          {linked && <Arrow />}
        </span>
        {body}
      </>
    );
  return (
    <>
      {icon}
      <span className="cg-text">
        <span className="cg-title">
          <span>
            <NoteText text={card.title} focusable={!linked} />
          </span>
          {tag}
        </span>
        {body}
      </span>
      {linked && <Arrow />}
    </>
  );
}

export function CardGridBlock({ data }: BlockProps) {
  const t = useTranslator(messages);
  const model = data as unknown as CardGridData;
  const variant = model.variant === "row" ? "row" : "tile";
  const columns = cardGridColumns(model);
  return (
    <section
      className={`sb-block cg-block cg-${variant}`}
      aria-label={blockLabel(model.title, t("title"))}
      data-columns={columns}
      style={{ "--cg-columns": columns } as CSSProperties}
    >
      {model.title && (
        <h3 className="cg-heading">
          <NoteText text={model.title} />
        </h3>
      )}
      <ul className="cg-grid">
        {model.cards.map((card, index) => {
          const tone = CARD_TONES.includes(card.tone!) ? card.tone : "brand";
          const href = card.href && isSafeHref(card.href) ? card.href : null;
          const content: ReactNode = (
            <CardContent
              card={card}
              tile={variant === "tile"}
              linked={Boolean(href)}
            />
          );
          return (
            <li key={index} className={`cg-item cg-tone-${tone}`}>
              {href && isExternalHref(href) ? (
                <a
                  className="cg-card is-link"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {content}
                  <span className="cg-hidden">{t("opensInNewTab")}</span>
                </a>
              ) : href ? (
                <a className="cg-card is-link" href={href}>
                  {content}
                </a>
              ) : (
                <div className="cg-card">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
