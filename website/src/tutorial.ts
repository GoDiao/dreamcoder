// The tutorial pages render the Markdown in docs/tutorial/ directly, so the
// site and the repository always show the same text.

export type Lang = 'zh' | 'en';

export const docIds = [
  'README',
  '00-overview',
  '01-execution-loop',
  '02-code-tools',
  '03-permissions',
  '04-session-context',
  '05-streaming-recovery',
  '06-desktop-integration',
] as const;

export type DocId = (typeof docIds)[number];

export const docTitles: Record<Lang, Record<DocId, string>> = {
  zh: {
    README: '目录与阅读约定',
    '00-overview': '编程智能体如何完成一次代码修改',
    '01-execution-loop': '智能体的执行循环',
    '02-code-tools': '代码工具系统',
    '03-permissions': '工具权限控制与执行边界',
    '04-session-context': '会话持久化与上下文工程',
    '05-streaming-recovery': '流式响应与故障恢复',
    '06-desktop-integration': '模型接入与桌面端集成',
  },
  en: {
    README: 'Contents and conventions',
    '00-overview': 'How a coding agent completes a code change',
    '01-execution-loop': "The agent's execution loop",
    '02-code-tools': 'The code tool system',
    '03-permissions': 'Tool permission control and execution boundaries',
    '04-session-context': 'Session persistence and context engineering',
    '05-streaming-recovery': 'Streaming responses and failure recovery',
    '06-desktop-integration': 'Model access and desktop integration',
  },
};

const TUTORIAL_DIR = '../../docs/tutorial/';
export const GITHUB_TUTORIAL_BLOB = 'https://github.com/GoDiao/dreamcoder/blob/main/docs/tutorial/';

const markdownLoaders = import.meta.glob('../../docs/tutorial/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const assetUrls = import.meta.glob('../../docs/tutorial/assets/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function isDocId(value: string | null): value is DocId {
  return value !== null && (docIds as readonly string[]).includes(value);
}

export function docFileName(id: DocId, lang: Lang): string {
  if (id === 'README') return lang === 'zh' ? 'README.md' : 'README.en.md';
  return `${id}.${lang}.md`;
}

export function loadDoc(id: DocId, lang: Lang): Promise<string> {
  const loader = markdownLoaders[`${TUTORIAL_DIR}${docFileName(id, lang)}`];
  if (!loader) return Promise.reject(new Error(`Missing tutorial file: ${docFileName(id, lang)}`));
  return loader();
}

export function tutorialAssetUrl(src: string): string | undefined {
  const name = src.replace(/^(\.\/)?assets\//, '');
  return assetUrls[`${TUTORIAL_DIR}assets/${name}`];
}

export interface DocTarget {
  id: DocId;
  lang: Lang;
  hash: string;
}

// Maps links between tutorial files, such as ./01-execution-loop.zh.md#anchor
// or ./README.en.md, to the page that renders that file.
export function parseDocLink(href: string): DocTarget | null {
  const match = /^\.\/(README(?:\.en)?|\d\d-[a-z-]+\.(?:zh|en))\.md(#.*)?$/.exec(href);
  if (!match) return null;
  const [, file, hash = ''] = match;
  if (file === 'README') return { id: 'README', lang: 'zh', hash };
  if (file === 'README.en') return { id: 'README', lang: 'en', hash };
  const id = file.slice(0, -3);
  const lang = file.slice(-2) as Lang;
  return isDocId(id) ? { id, lang, hash } : null;
}

export function docUrl(id: DocId, lang: Lang, hash = ''): string {
  return `${import.meta.env.BASE_URL}?doc=${id}&lang=${lang}${hash}`;
}
