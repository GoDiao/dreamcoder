import { Suspense, lazy, useEffect, useState, type MouseEvent } from 'react';
import { ArrowRight, BookOpen, ExternalLink, Github, Laptop, LockKeyhole, Monitor, Smartphone, Terminal } from 'lucide-react';

import { docIds, docTitles, docUrl, isDocId, type DocId, type DocTarget, type Lang } from './tutorial';

const DocPage = lazy(() => import('./DocPage'));

type Language = Lang;

const copy = {
  zh: {
    navFeatures: '功能',
    navTutorial: '源码导读',
    navAccess: '手机接续',
    navPlatforms: '平台与安装',
    eyebrow: '开源 · 本地运行 · 多模型',
    title: '把 AI 编程会话，放进一个看得清的工作台。',
    intro: 'DreamCoder 在桌面管理 Claude Code 工作流。配置你选择的模型服务，查看会话、终端与工具调用；开启 H5 后，还能在同一局域网内从手机浏览器接续会话。',
    source: '查看源码与构建指南',
    releases: '查看发布状态',
    releaseNote: 'v0.4.5 Release 未附安装包；请按 README 从源码运行，并在 Releases 页面查看后续发布状态。',
    screenshotLabel: '真实桌面界面',
    featureEyebrow: '三个日常入口',
    featureTitle: '模型、会话、工具，都在桌面上。',
    features: [
      { number: '01', title: '选择模型服务', description: '配置 Anthropic 或 OpenAI 兼容接口。提供 DeepSeek、通义千问、Kimi、智谱 GLM、LM Studio、Ollama 等预设，也支持自定义端点。实际可用模型取决于服务商和配置。', image: '/assets/setting_provider.png', alt: 'DreamCoder Provider 设置界面' },
      { number: '02', title: '跟进编程过程', description: '在一个界面查看会话、终端、文件变更和工具调用。Computer Use 与 MCP 配置也有可视化入口。', image: '/assets/setting_computeruse.png', alt: 'DreamCoder Computer Use 设置界面' },
      { number: '03', title: '管理 MCP 扩展', description: '在设置界面管理 MCP 服务器，按项目需要接入工具。', image: '/assets/setting_skills.png', alt: 'DreamCoder MCP 设置界面' },
    ],
    tutorialEyebrow: '源码导读',
    tutorialTitle: '沿一次代码修改，读懂编程智能体。',
    tutorialBody: '七篇源码导读从一条“把 value 改成 2”的消息讲起：它怎样变成多次模型请求和工具执行，程序怎样校验参数、请求确认、保存会话，又怎样处理取消和失败。文中结论都附有指向固定版本源码的链接。',
    tutorialNote: '需要 TypeScript 基础和 async/await。',
    tutorialLink: '开始阅读',
    accessEyebrow: '离开桌面时',
    accessTitle: '同一局域网内，用手机接续会话。',
    accessBody: '在桌面设置中启用 H5 接入、管理访问 Token，并用二维码连接手机浏览器。桌面应用需要保持运行。跨网络访问需要自行配置反向代理；部署指南仍在编写。',
    accessLink: '查看 H5 路线图',
    platformsEyebrow: '当前状态',
    platformsTitle: '从源码开始，了解平台支持。',
    windows: 'Windows x64',
    windowsBody: '维护者日常验证。v0.4.5 Release 没有预编译安装包。',
    mac: 'macOS arm64',
    macBody: '保留构建支持，尚未纳入维护者的日常实机验证。',
    linux: 'Linux x64',
    linuxBody: '尚未纳入日常实机验证，现有内存问题仍在调查。',
    privacyTitle: '本地运行与数据边界',
    privacyBody: 'Provider 配置和 API Key 写入本机文件。使用云端模型时，请求内容会发送给你选择的服务商。启用 H5 后，请妥善保管访问 Token。',
    privacyLink: '阅读隐私说明',
    contribute: '参与贡献',
    footer: 'DreamCoder · MIT License',
  },
  en: {
    navFeatures: 'Features',
    navTutorial: 'Walkthrough',
    navAccess: 'Phone access',
    navPlatforms: 'Platforms & setup',
    eyebrow: 'Open source · Locally run · Multi-provider',
    title: 'A clear workspace for your AI coding sessions.',
    intro: 'DreamCoder manages Claude Code workflows on your desktop. Configure your chosen model provider, follow sessions, terminal and tool activity, then continue from a phone browser on the same LAN after enabling H5 Access.',
    source: 'Source and build guide',
    releases: 'Release status',
    releaseNote: 'Release v0.4.5 has no installer attached. Follow the README to run from source and check Releases for newer assets.',
    screenshotLabel: 'Actual desktop interface',
    featureEyebrow: 'Three everyday entry points',
    featureTitle: 'Models, sessions, and tools on your desktop.',
    features: [
      { number: '01', title: 'Choose a model provider', description: 'Configure Anthropic or OpenAI-compatible endpoints. Presets include DeepSeek, Qwen, Kimi, Zhipu GLM, LM Studio, and Ollama, plus custom endpoints. Model availability depends on your provider and configuration.', image: '/assets/setting_provider.png', alt: 'DreamCoder Provider settings' },
      { number: '02', title: 'Follow the coding process', description: 'Review sessions, terminal activity, file changes, and tool calls in one place. Computer Use and MCP also have visual settings.', image: '/assets/setting_computeruse.png', alt: 'DreamCoder Computer Use settings' },
      { number: '03', title: 'Manage MCP extensions', description: 'Manage MCP servers in Settings and connect the tools your project needs.', image: '/assets/setting_skills.png', alt: 'DreamCoder MCP settings' },
    ],
    tutorialEyebrow: 'Source code walkthrough',
    tutorialTitle: 'Learn how a coding agent works, one code change at a time.',
    tutorialBody: 'A seven-part walkthrough starts from a single "change value to 2" message: how it turns into several model requests and tool runs, how the program validates arguments, asks for confirmation, and saves the session, and how it handles cancellation and failure. Each point links to a pinned version of the source.',
    tutorialNote: 'Assumes basic TypeScript and async/await.',
    tutorialLink: 'Start reading',
    accessEyebrow: 'Away from your desk',
    accessTitle: 'Continue on your phone over the same LAN.',
    accessBody: 'Enable H5 Access in desktop Settings, manage the access token, and connect a phone browser with the QR code. Keep the desktop app running. Cross-network access requires your own reverse proxy; the deployment guide is still in progress.',
    accessLink: 'H5 roadmap',
    platformsEyebrow: 'Current status',
    platformsTitle: 'Run from source and check platform support.',
    windows: 'Windows x64',
    windowsBody: 'Regularly tested by the maintainer. Release v0.4.5 has no pre-built installer.',
    mac: 'macOS arm64',
    macBody: 'Build support exists, but it is not part of the maintainer’s daily device validation.',
    linux: 'Linux x64',
    linuxBody: 'Not part of daily device validation; a memory issue remains under investigation.',
    privacyTitle: 'Local runtime and data flow',
    privacyBody: 'Provider settings and API keys are written to local files. Requests to cloud models go to your chosen provider. Protect the access token when you enable H5.',
    privacyLink: 'Read the privacy notice',
    contribute: 'Contribute',
    footer: 'DreamCoder · MIT License',
  },
} as const;

const github = 'https://github.com/GoDiao/dreamcoder';
const atomgit = 'https://atomgit.com/GoDiao/DreamCoder';
const base = import.meta.env.BASE_URL;

function readRoute(): { doc: DocId | null; lang: Language | null } {
  const params = new URLSearchParams(window.location.search);
  const doc = params.get('doc');
  const lang = params.get('lang');
  return { doc: isDocId(doc) ? doc : null, lang: lang === 'zh' || lang === 'en' ? lang : null };
}

export default function App() {
  const [doc, setDoc] = useState<DocId | null>(() => readRoute().doc);
  const [lang, setLang] = useState<Language>(() => readRoute().lang ?? (window.localStorage.getItem('dreamcoder-site-language') === 'en' ? 'en' : 'zh'));
  const t = copy[lang];

  useEffect(() => {
    function onPopState() {
      const route = readRoute();
      setDoc(route.doc);
      if (route.lang) setLang(route.lang);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function openDoc(target: DocTarget) {
    window.history.pushState(null, '', docUrl(target.id, target.lang, target.hash));
    window.localStorage.setItem('dreamcoder-site-language', target.lang);
    setLang(target.lang);
    setDoc(target.id);
  }

  function followDoc(target: DocTarget) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      openDoc(target);
    };
  }

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    if (!doc) document.title = `DreamCoder · ${lang === 'zh' ? '本地运行的多模型 AI 编程工作台' : 'A locally run, multi-provider AI coding workspace'}`;
  }, [lang, doc]);

  function changeLanguage(next: Language) {
    if (doc) {
      openDoc({ id: doc, lang: next, hash: '' });
      return;
    }
    setLang(next);
    window.localStorage.setItem('dreamcoder-site-language', next);
  }

  return (
    <div className="min-h-screen bg-brand-bg-primary text-brand-text-body">
      <header className="sticky top-0 z-30 border-b border-brand-border bg-brand-bg-primary/95 backdrop-blur-md">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8" aria-label="Main navigation">
          <a href={base} className="flex items-center gap-3 font-serif text-xl font-semibold text-brand-text-title">
            <span className="flex size-8 items-center justify-center rounded-sm bg-brand-text-title font-mono text-sm font-bold text-brand-bg-primary">D</span>
            DreamCoder
          </a>
          <div className="hidden items-center gap-7 text-xs font-medium md:flex">
            <a className="hover:text-brand-caramel" href={`${base}#features`}>{t.navFeatures}</a>
            <a className="hover:text-brand-caramel" href={`${base}#tutorial`}>{t.navTutorial}</a>
            <a className="hover:text-brand-caramel" href={`${base}#access`}>{t.navAccess}</a>
            <a className="hover:text-brand-caramel" href={`${base}#platforms`}>{t.navPlatforms}</a>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-brand-border p-0.5 font-mono text-[11px]" aria-label="Language">
              <button type="button" onClick={() => changeLanguage('zh')} aria-pressed={lang === 'zh'} className={`rounded px-2 py-1 ${lang === 'zh' ? 'bg-brand-text-title text-white' : 'hover:bg-brand-bg-secondary'}`}>中文</button>
              <button type="button" onClick={() => changeLanguage('en')} aria-pressed={lang === 'en'} className={`rounded px-2 py-1 ${lang === 'en' ? 'bg-brand-text-title text-white' : 'hover:bg-brand-bg-secondary'}`}>EN</button>
            </div>
            <a href={github} target="_blank" rel="noreferrer" className="rounded-md border border-brand-border p-2 text-brand-text-title hover:bg-brand-bg-secondary" aria-label="GitHub"><Github size={16} /></a>
          </div>
        </nav>
      </header>

      {doc ? (
        <main>
          <Suspense fallback={<p className="mx-auto max-w-7xl px-5 py-14 text-sm text-brand-text-muted md:px-8">{lang === 'zh' ? '正在加载……' : 'Loading…'}</p>}>
            <DocPage id={doc} lang={lang} onNavigate={openDoc} />
          </Suspense>
        </main>
      ) : (
      <main id="top">
        <section className="relative overflow-hidden border-b border-brand-border">
          <div className="pointer-events-none absolute -right-28 -top-40 size-[36rem] rounded-full border border-brand-border/70" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-10 -top-24 size-[28rem] rounded-full border border-brand-border/70" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-20 md:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-16 lg:py-28">
            <div>
              <p className="mb-5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.eyebrow}</p>
              <h1 className="max-w-xl font-serif text-5xl font-semibold leading-[1.08] tracking-tight text-brand-text-title md:text-6xl">{t.title}</h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-brand-text-body">{t.intro}</p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a href={`${github}/blob/main/${lang === 'zh' ? 'README.md' : 'README_en.md'}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md bg-brand-text-title px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-caramel">{t.source}<ArrowRight size={16} /></a>
                <a href={`${github}/releases`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-brand-border px-5 py-3 text-sm font-semibold text-brand-text-title transition hover:bg-brand-bg-secondary">{t.releases}<ExternalLink size={15} /></a>
              </div>
              <p className="mt-5 max-w-md border-l-2 border-brand-caramel pl-3 text-xs leading-6 text-brand-text-muted">{t.releaseNote}</p>
            </div>
            <figure className="relative">
              <div className="absolute -inset-4 rotate-2 rounded-xl bg-brand-bg-secondary" aria-hidden="true" />
              <img src={`${import.meta.env.BASE_URL}assets/main.png`} alt={t.screenshotLabel} className="relative w-full rounded-lg border border-brand-border shadow-xl" />
              <figcaption className="relative mt-3 font-mono text-[11px] text-brand-text-muted">{t.screenshotLabel}</figcaption>
            </figure>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-5 py-20 md:px-8">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.featureEyebrow}</p>
          <h2 className="mt-3 max-w-2xl font-serif text-4xl font-semibold text-brand-text-title md:text-5xl">{t.featureTitle}</h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {t.features.map((feature) => (
              <article key={feature.number} className="overflow-hidden rounded-lg border border-brand-border bg-white/70">
                <div className="border-b border-brand-border p-6">
                  <span className="font-mono text-xs text-brand-caramel">{feature.number}</span>
                  <h3 className="mt-3 font-serif text-2xl font-semibold">{feature.title}</h3>
                  <p className="mt-3 min-h-24 text-sm leading-7 text-brand-text-muted">{feature.description}</p>
                </div>
                <div className="bg-brand-bg-secondary p-3">
                  <img src={`${import.meta.env.BASE_URL}${feature.image.slice(1)}`} alt={feature.alt} loading="lazy" className="aspect-[16/10] w-full rounded border border-brand-border object-cover object-left-top" />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="tutorial" className="border-t border-brand-border">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 md:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <BookOpen size={23} strokeWidth={1.5} className="text-brand-caramel" />
              <p className="mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.tutorialEyebrow}</p>
              <h2 className="mt-3 max-w-xl font-serif text-4xl font-semibold text-brand-text-title md:text-5xl">{t.tutorialTitle}</h2>
              <p className="mt-5 max-w-xl text-sm leading-8">{t.tutorialBody}</p>
              <p className="mt-3 text-xs text-brand-text-muted">{t.tutorialNote}</p>
              <a href={docUrl('README', lang)} onClick={followDoc({ id: 'README', lang, hash: '' })} className="mt-7 inline-flex items-center gap-2 rounded-md bg-brand-text-title px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-caramel">{t.tutorialLink}<ArrowRight size={16} /></a>
            </div>
            <ol className="divide-y divide-brand-border self-start rounded-lg border border-brand-border bg-white/70">
              {docIds.slice(1).map((docId) => (
                <li key={docId}>
                  <a href={docUrl(docId, lang)} onClick={followDoc({ id: docId, lang, hash: '' })} className="flex items-baseline gap-4 px-5 py-4 hover:bg-brand-bg-secondary/60">
                    <span className="font-mono text-xs text-brand-caramel">{docId.slice(0, 2)}</span>
                    <span className="font-serif text-lg font-semibold text-brand-text-title">{docTitles[lang][docId]}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="access" className="border-y border-brand-border bg-brand-bg-secondary">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 md:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div className="flex size-20 items-center justify-center rounded-full border border-brand-caramel/40 text-brand-caramel"><Smartphone size={36} strokeWidth={1.3} /></div>
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.accessEyebrow}</p>
              <h2 className="mt-3 font-serif text-4xl font-semibold text-brand-text-title md:text-5xl">{t.accessTitle}</h2>
              <p className="mt-5 text-sm leading-8">{t.accessBody}</p>
              <a href={`${github}/blob/main/docs/ROADMAP_${lang}.md`} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-caramel hover:underline">{t.accessLink}<ArrowRight size={15} /></a>
            </div>
          </div>
        </section>

        <section id="platforms" className="mx-auto max-w-7xl px-5 py-20 md:px-8">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-caramel">{t.platformsEyebrow}</p>
          <h2 className="mt-3 max-w-2xl font-serif text-4xl font-semibold text-brand-text-title md:text-5xl">{t.platformsTitle}</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: Monitor, name: t.windows, detail: t.windowsBody },
              { icon: Laptop, name: t.mac, detail: t.macBody },
              { icon: Terminal, name: t.linux, detail: t.linuxBody },
            ].map(({ icon: Icon, name, detail }) => (
              <div key={name} className="rounded-lg border border-brand-border bg-white/70 p-6">
                <Icon size={23} strokeWidth={1.5} className="text-brand-caramel" />
                <h3 className="mt-5 font-serif text-2xl font-semibold">{name}</h3>
                <p className="mt-2 text-sm leading-7 text-brand-text-muted">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-brand-border bg-brand-text-title px-5 py-16 text-brand-bg-primary md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-7 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <LockKeyhole size={23} strokeWidth={1.5} className="text-brand-caramel" />
              <h2 className="mt-4 font-serif text-3xl font-semibold text-white">{t.privacyTitle}</h2>
              <p className="mt-3 text-sm leading-7 text-brand-bg-secondary">{t.privacyBody}</p>
            </div>
            <a href={`${github}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 self-start rounded-md border border-brand-bg-secondary/40 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10">{t.privacyLink}<ArrowRight size={15} /></a>
          </div>
        </section>
      </main>
      )}

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-brand-text-muted md:px-8">
        <span>{t.footer}</span>
        <div className="flex gap-5">
          <a href={`${github}/blob/main/docs/CONTRIBUTING_${lang}.md`} target="_blank" rel="noreferrer" className="hover:text-brand-caramel">{t.contribute}</a>
          <a href={github} target="_blank" rel="noreferrer" className="hover:text-brand-caramel">GitHub</a>
          <a href={atomgit} target="_blank" rel="noreferrer" className="hover:text-brand-caramel">AtomGit</a>
        </div>
      </footer>
    </div>
  );
}
