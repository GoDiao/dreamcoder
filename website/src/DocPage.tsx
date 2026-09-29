import { useCallback, useEffect, useId, useRef, useState, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import {
  GITHUB_TUTORIAL_BLOB,
  docFileName,
  docIds,
  docTitles,
  docUrl,
  loadDoc,
  parseDocLink,
  tutorialAssetUrl,
  type DocId,
  type DocTarget,
  type Lang,
} from './tutorial';

const labels = {
  zh: { contents: '目录', loading: '正在加载……', error: '文章加载失败。', previous: '上一篇', next: '下一篇', source: '在 GitHub 上查看此页' },
  en: { contents: 'Contents', loading: 'Loading…', error: 'The page failed to load.', previous: 'Previous', next: 'Next', source: 'View this page on GitHub' },
} as const;

interface DocPageProps {
  id: DocId;
  lang: Lang;
  onNavigate: (target: DocTarget) => void;
}

// The first line of each file links to the other language. The site header
// already has a language switch, so the line is dropped here.
function stripLanguageSwitch(markdown: string): string {
  return markdown.replace(/^(?:\[English\]\([^)]*\) \| 简体中文|English \| \[简体中文\]\([^)]*\))\s*\n+/, '');
}

function Mermaid({ code, onRendered }: { code: string; onRendered: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'IBM Plex Sans, sans-serif' });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          onRendered();
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, id, onRendered]);

  if (failed) return <pre><code>{code}</code></pre>;
  return <div ref={ref} className="doc-mermaid not-prose" />;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(textOf).join('');
}

export default function DocPage({ id, lang, onNavigate }: DocPageProps) {
  const t = labels[lang];
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // Diagrams render after the text and push later headings down, so the
  // target of a #hash link is scrolled into view again after each diagram
  // until the reader scrolls on their own.
  const pendingHash = useRef('');
  const keepHashInView = useCallback(() => {
    const target = pendingHash.current ? document.getElementById(pendingHash.current) : null;
    target?.scrollIntoView();
  }, []);

  useEffect(() => {
    const stop = () => { pendingHash.current = ''; };
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    events.forEach((name) => window.addEventListener(name, stop, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, stop));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMarkdown(null);
    setError(false);
    loadDoc(id, lang)
      .then((text) => {
        if (!cancelled) setMarkdown(stripLanguageSwitch(text));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, lang]);

  useEffect(() => {
    if (markdown === null) return;
    const title = /^# (.+)$/m.exec(markdown)?.[1] ?? docTitles[lang][id];
    document.title = `${title.replace(/`/g, '')} · DreamCoder`;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    pendingHash.current = hash;
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [markdown, id, lang]);

  function follow(target: DocTarget) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onNavigate(target);
    };
  }

  const components: Components = {
    a({ href = '', children, node: _node, ...rest }) {
      const doc = parseDocLink(href);
      if (doc) return <a {...rest} href={docUrl(doc.id, doc.lang, doc.hash)} onClick={follow(doc)}>{children}</a>;
      if (href.startsWith('#')) return <a {...rest} href={href}>{children}</a>;
      const external = /^https?:\/\//.test(href) ? href : new URL(href, GITHUB_TUTORIAL_BLOB).toString();
      return <a {...rest} href={external} target="_blank" rel="noreferrer">{children}</a>;
    },
    img({ src = '', alt, node: _node, ...rest }) {
      const resolved = typeof src === 'string' ? tutorialAssetUrl(src) ?? src : src;
      return <img {...rest} src={resolved} alt={alt ?? ''} loading="lazy" />;
    },
    table({ children, node: _node, ...rest }) {
      return <div className="doc-table"><table {...rest}>{children}</table></div>;
    },
    pre({ children, node, ...rest }: ComponentPropsWithoutRef<'pre'> & { node?: unknown; children?: ReactNode }) {
      const code = (node as { children?: { properties?: { className?: string[] } }[] } | undefined)?.children?.[0];
      if (code?.properties?.className?.includes('language-mermaid')) return <Mermaid code={textOf(code).trimEnd()} onRendered={keepHashInView} />;
      return <pre {...rest}>{children}</pre>;
    },
  };

  const index = docIds.indexOf(id);
  const previous = index > 0 ? docIds[index - 1] : null;
  const next = index < docIds.length - 1 ? docIds[index + 1] : null;

  const contents = (
    <ol className="space-y-1 text-sm">
      {docIds.map((docId) => (
        <li key={docId}>
          <a
            href={docUrl(docId, lang)}
            onClick={follow({ id: docId, lang, hash: '' })}
            aria-current={docId === id ? 'page' : undefined}
            className={`block rounded px-3 py-2 leading-5 ${docId === id ? 'bg-brand-bg-secondary font-semibold text-brand-text-title' : 'text-brand-text-muted hover:bg-brand-bg-secondary/60 hover:text-brand-text-title'}`}
          >
            <span className="mr-2 font-mono text-[11px] text-brand-caramel">{docId === 'README' ? '··' : docId.slice(0, 2)}</span>
            {docTitles[lang][docId]}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-5 py-10 md:px-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:py-14">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <details className="rounded-lg border border-brand-border bg-white/60 lg:hidden">
          <summary className="cursor-pointer px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-caramel">{t.contents}</summary>
          <nav className="px-1 pb-2" aria-label={t.contents}>{contents}</nav>
        </details>
        <nav className="hidden lg:block" aria-label={t.contents}>
          <p className="mb-3 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.contents}</p>
          {contents}
        </nav>
      </aside>

      <article className="min-w-0">
        {error && <p className="text-sm text-brand-text-muted">{t.error}</p>}
        {!error && markdown === null && <p className="text-sm text-brand-text-muted">{t.loading}</p>}
        {markdown !== null && (
          <div className="doc-prose prose max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug, [rehypeHighlight, { detect: false, plainText: ['mermaid', 'text', 'jsonl'] }]]}
              components={components}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        )}

        <footer className="mt-14 border-t border-brand-border pt-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {previous ? (
              <a href={docUrl(previous, lang)} onClick={follow({ id: previous, lang, hash: '' })} className="rounded-lg border border-brand-border p-4 hover:bg-brand-bg-secondary/60">
                <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-brand-caramel"><ArrowLeft size={13} />{t.previous}</span>
                <span className="mt-1 block font-serif text-lg font-semibold text-brand-text-title">{docTitles[lang][previous]}</span>
              </a>
            ) : <span />}
            {next && (
              <a href={docUrl(next, lang)} onClick={follow({ id: next, lang, hash: '' })} className="rounded-lg border border-brand-border p-4 text-right hover:bg-brand-bg-secondary/60 sm:col-start-2">
                <span className="flex items-center justify-end gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-brand-caramel">{t.next}<ArrowRight size={13} /></span>
                <span className="mt-1 block font-serif text-lg font-semibold text-brand-text-title">{docTitles[lang][next]}</span>
              </a>
            )}
          </div>
          <a href={`${GITHUB_TUTORIAL_BLOB}${docFileName(id, lang)}`} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-xs text-brand-text-muted hover:text-brand-caramel">
            {t.source}<ExternalLink size={12} />
          </a>
        </footer>
      </article>
    </div>
  );
}
