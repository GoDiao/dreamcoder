import { useState, useEffect, useRef } from 'react';
import { 
  Bot, Shield, Cpu, Layers, Wrench, Monitor, Search, Plus, Trash2, 
  RefreshCw, Settings, Folder, Check, AlertTriangle, ChevronRight, 
  Sliders, Github, ExternalLink, Play, Terminal, ChevronDown, Copy, 
  HelpCircle, Sparkles, Code2, Globe, Minimize2, ZoomIn, ArrowRight,
  BookOpen, Star, Info, Sparkle, Download, Layers2, ShieldCheck, Zap
} from 'lucide-react';
import { PageRoute } from './types';
import { useLanguage } from './context/LanguageContext';
import AppShowcase from './components/AppShowcase';
import DocsSection from './components/DocsSection';
import DesignSpec from './components/DesignSpec';

export default function App() {
  const { 
    lang, 
    setLang, 
    t, 
    CORE_FEATURES, 
    COMPARISON_TABLE, 
    SETTINGS_SHOWCASES, 
    ARCHITECTURE_LAYERS, 
    BENCHMARKS 
  } = useLanguage();

  const [currentPage, setCurrentPage] = useState<PageRoute>('landing');
  const [selectedBenchmarkCat, setSelectedBenchmarkCat] = useState<'all' | 'performance' | 'resource' | 'ux'>('all');

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentPage]);
  
  // Interactive Download Simulation state
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadOS, setDownloadOS] = useState<string>('');
  
  // Active showcase channel binder state (which tab of simulator is active)
  const [simulatorActiveTab, setSimulatorActiveTab] = useState<string>('main');

  // Trigger simulated download triggers
  const triggerDownloadAction = (os: string) => {
    if (downloadProgress !== null) return;
    setDownloadOS(os);
    setDownloadProgress(0);
    
    const interval = setInterval(() => {
      setDownloadProgress(prev => {
        if (prev === null) {
          clearInterval(interval);
          return null;
        }
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setDownloadProgress(null);
            alert(lang === 'zh' 
              ? `DreamCoder Native Desktop Bundle (*.${os === 'Windows' ? 'msi' : 'dmg'}) 下载预备完成！大小仅 8.4MB，开箱即用。` 
              : `DreamCoder Native Desktop Bundle (*.${os === 'Windows' ? 'msi' : 'dmg'}) download prepared successfully! Size 8.4MB, pre-configured out-of-the-box.`
            );
          }, 600);
          return 100;
        }
        return prev + 10;
      });
    }, 150);
  };

  // Safe handler to jump directly to deep settings inside the live simulator
  const jumpToSimulatorTab = (tabName: string) => {
    setSimulatorActiveTab(tabName);
    const element = document.getElementById('interactive-workbench-container');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Filter benchmarks on client state
  const filteredBenchmarks = BENCHMARKS.filter(b => {
    if (selectedBenchmarkCat === 'all') return true;
    return b.category === selectedBenchmarkCat;
  });

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg-primary text-brand-text-body">
      
      {/* Editorial Header navigation bar */}
      <header className="sticky top-0 z-30 bg-brand-bg-primary/95 backdrop-blur-md border-b border-brand-border select-none">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          
          {/* Logo & Product Brand Label */}
          <div 
            onClick={() => setCurrentPage('landing')} 
            className="flex items-center gap-2.5 cursor-pointer text-brand-text-title hover:text-brand-caramel transition-colors"
          >
            <span className="bg-brand-caramel text-brand-bg-primary h-6 w-6 rounded flex items-center justify-center font-bold text-sm tracking-tighter">D</span>
            <div className="font-serif font-black tracking-tight text-lg flex items-baseline gap-1.5">
              <span>DreamCoder</span>
              <span className="text-[10px] font-sans font-semibold border border-brand-border px-1.5 py-0.2 bg-brand-bg-secondary text-brand-text-muted rounded">
                {t('brand.badge')}
              </span>
            </div>
          </div>

          {/* Master view Switchers */}
          <nav className="flex items-center gap-1.5 md:gap-3 text-xs font-mono font-medium">
            <button 
              id="nav-link-landing"
              onClick={() => {
                setCurrentPage('landing');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentPage === 'landing' ? 'bg-brand-bg-card text-brand-caramel font-bold border border-brand-border/60' : 'text-brand-text-muted hover:text-brand-text-title'}`}
            >
              {t('nav.home')}
            </button>
            <button 
              id="nav-link-docs"
              onClick={() => {
                setCurrentPage('docs');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentPage === 'docs' ? 'bg-brand-bg-card text-brand-caramel font-bold border border-brand-border/60' : 'text-brand-text-muted hover:text-brand-text-title'}`}
            >
              {t('nav.docs')}
            </button>
            <button 
              id="nav-link-spec"
              onClick={() => {
                setCurrentPage('spec');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${currentPage === 'spec' ? 'bg-brand-bg-card text-brand-caramel font-bold border border-brand-border/60' : 'text-brand-text-muted hover:text-brand-text-title'}`}
            >
              {t('nav.spec')}
            </button>
          </nav>

          {/* Language Switcher and Github Badge */}
          <div className="flex items-center gap-2.5">
            {/* Elegant physical lang switcher */}
            <div className="flex items-center gap-0.5 border border-brand-border bg-brand-bg-secondary p-0.5 rounded-lg text-[10px] font-mono select-none">
              <button
                onClick={() => setLang('zh')}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${lang === 'zh' ? 'bg-brand-caramel text-brand-bg-primary font-bold shadow-2xs' : 'text-brand-text-muted hover:text-brand-text-title'}`}
              >
                中文
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${lang === 'en' ? 'bg-brand-caramel text-brand-bg-primary font-bold shadow-2xs' : 'text-brand-text-muted hover:text-brand-text-title'}`}
              >
                EN
              </button>
            </div>

            {/* GitHub Widget */}
            <div className="hidden sm:flex items-center">
              <a 
                href="https://github.com/GoDiao/dreamcoder" 
                target="_blank" 
                rel="noreferrer" 
                className="flex items-center gap-1.5 text-xs font-mono font-medium px-3 py-1 bg-brand-bg-secondary text-brand-text-title hover:text-brand-caramel border border-brand-border rounded-lg transition-all shadow-2xs hover:shadow-xs hover:translate-y-[-1px]"
              >
                <Github size={12} />
                <span>{t('nav.github')}</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main viewport Container */}
      <main className="flex-1">
        
        {/* ==================== PAGE 1: LANDING PAGE ==================== */}
        {currentPage === 'landing' && (
          <div className="space-y-20 pb-20 animate-fade-in" id="landing-page-parent">
            
            {/* SECTION 1: HERO AREA */}
            <section className="max-w-7xl mx-auto px-4 md:px-8 pt-10 md:pt-16 space-y-10" id="editorial-hero">
              <div className="text-center max-w-3xl mx-auto space-y-4">
                
                {/* Visual Label tag */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#efe8de] rounded-full border border-brand-border text-[11px] font-mono font-semibold text-brand-caramel tracking-wider uppercase select-none">
                  <Sparkle size={11} className="animate-spin-slow text-brand-caramel" />
                  <span>{t('brand.subtitle')}</span>
                </div>

                <h1 className="text-4xl md:text-6xl serif-display tracking-tight text-brand-text-title font-bold leading-[1.1] selection:bg-brand-caramel/10">
                  DreamCoder 
                  <span className="block text-xl md:text-2xl font-mono text-brand-caramel mt-3 font-semibold">
                    {t('hero.title')}
                  </span>
                </h1>

                {/* Editorial text width bounded strictly to 65ch */}
                <p className="text-sm md:text-base leading-relaxed text-brand-text-body max-w-[65ch] mx-auto selection:bg-brand-caramel/10">
                  {t('hero.desc')}
                </p>

                {/* Interactive CTA buttons */}
                <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                  <a
                    href="https://github.com/GoDiao/dreamcoder/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-2.5 bg-brand-caramel hover:bg-brand-caramel/90 text-brand-bg-primary font-mono text-xs font-bold rounded-xl transition duration-200 cursor-pointer shadow-xs hover:shadow-md hover:translate-y-[-1px] flex items-center gap-2"
                  >
                    <Download size={14} />
                    {t('hero.btn.win')}
                  </a>
                  <a
                    href="https://github.com/GoDiao/dreamcoder/releases"
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-2.5 bg-brand-bg-card hover:bg-brand-border text-brand-text-title border border-brand-border font-mono text-xs font-bold rounded-xl transition duration-200 cursor-pointer shadow-xs hover:shadow-md hover:translate-y-[-1px] flex items-center gap-2"
                  >
                    <Download size={14} />
                    {t('hero.btn.mac')}
                  </a>
                  <button
                    onClick={() => {
                      setCurrentPage('docs');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="px-4 py-2.5 hover:underline text-brand-caramel font-mono text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span>{t('hero.btn.docs')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>

                {/* Simulated Download Status Card */}
                {downloadProgress !== null && (
                  <div className="max-w-md mx-auto p-4 bg-brand-bg-card border border-brand-caramel/40 rounded-xl space-y-2 mt-4 animate-slide-in-right text-xs font-mono">
                    <div className="flex items-center justify-between text-brand-text-title font-bold">
                      <span className="flex items-center gap-1.5">
                        <RefreshCw size={12} className="animate-spin text-brand-caramel" />
                        {t('hero.dl.sim').replace('{os}', downloadOS)}
                      </span>
                      <span>{downloadProgress}%</span>
                    </div>
                    <div className="w-full bg-brand-bg-primary h-2 rounded overflow-hidden border border-brand-border">
                      <div className="bg-brand-caramel h-full transition-all duration-150" style={{ width: `${downloadProgress}%` }}></div>
                    </div>
                    <div className="text-[10px] text-brand-text-muted text-left leading-relaxed">
                      {t('hero.dl.tip').replace('{os}', downloadOS)}
                    </div>
                  </div>
                )}

                {/* Three Data highlights metrics */}
                <div className="grid grid-cols-3 gap-4 pt-8 max-w-sm sm:max-w-xl mx-auto text-center font-mono">
                  <div className="p-3 bg-brand-bg-secondary/40 border border-brand-border rounded-lg select-none">
                    <span className="block text-xl sm:text-2xl font-bold text-brand-caramel tracking-tight">&lt;1ms</span>
                    <span className="text-[9px] sm:text-[10px] text-brand-text-muted mt-1 uppercase block">{t('hero.metrics.ipc')}</span>
                  </div>
                  <div className="p-3 bg-brand-bg-secondary/40 border border-brand-border rounded-lg select-none">
                    <span className="block text-xl sm:text-2xl font-bold text-brand-caramel tracking-tight">8+</span>
                    <span className="text-[9px] sm:text-[10px] text-brand-text-muted mt-1 uppercase block">{t('hero.metrics.models')}</span>
                  </div>
                  <div className="p-3 bg-brand-bg-secondary/40 border border-brand-border rounded-lg select-none">
                    <span className="block text-xl sm:text-2xl font-bold text-brand-caramel tracking-tight">0 字节</span>
                    <span className="text-[9px] sm:text-[10px] text-brand-text-muted mt-1 uppercase block">{t('hero.metrics.security')}</span>
                  </div>
                </div>
              </div>

              {/* Dynamic Workbench Live showcase simulator container */}
              <div className="space-y-3 pt-6" id="interactive-workbench-container">
                <div className="text-center font-mono text-xs text-brand-text-muted select-none flex items-center justify-center gap-1.5">
                  <Monitor size={12} className="text-brand-caramel" />
                  <span>{t('hero.sim.title')}</span>
                </div>
                {/* Showcase mounting responsive canvas replicas */}
                <AppShowcase initialTab={simulatorActiveTab} />
              </div>
            </section>

            {/* SECTION 2: WHY CHOOSE DREAMCODER (COMPARATIVE TABLE ANALYSIS) */}
            <section className="bg-[#efe8de]/50 border-y border-brand-border py-16">
              <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-8">
                <div className="text-center max-w-xl mx-auto">
                  <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase">{t('cmp.badge')}</span>
                  <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight mt-1">{t('cmp.title')}</h2>
                  <p className="text-xs font-mono text-brand-text-muted mt-1">{t('cmp.subtitle')}</p>
                </div>

                {/* Comparison Tabular spreadsheet Layout */}
                <div className="max-w-4xl mx-auto border border-brand-border rounded-xl bg-brand-bg-primary overflow-x-auto shadow-2xs font-mono text-[11px] select-text">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-brand-bg-card border-b border-brand-border text-brand-text-title">
                        <th className="p-4 font-bold border-r border-brand-border text-xs">{t('cmp.col.criteria')}</th>
                        <th className="p-4 font-normal text-brand-text-muted">{t('cmp.col.cli')}</th>
                        <th className="p-4 font-normal text-brand-text-muted">{t('cmp.col.ext')}</th>
                        <th className="p-4 font-bold text-brand-caramel">{t('cmp.col.dc')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border text-brand-text-body">
                      {COMPARISON_TABLE.map((row, index) => (
                        <tr key={index} className="hover:bg-brand-bg-secondary/20 transition-colors">
                          <td className="p-4 font-bold border-r border-brand-border text-brand-text-title text-xs">
                            {row.criteria}
                          </td>
                          <td className="p-4 italic text-brand-text-muted">
                            {row.cli}
                          </td>
                          <td className="p-4 text-brand-text-muted">
                            {row.extension}
                          </td>
                          <td className={`p-4 font-semibold ${row.isDreamCoderBetter ? 'text-brand-caramel bg-brand-caramel/5/20' : ''}`}>
                            <div className="flex items-center gap-1.5">
                              <Check size={11} className="text-brand-success shrink-0" />
                              <span>{row.dreamcoder}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* SECTION 3: CORE SIX FEATURE CARDS */}
            <section className="max-w-7xl mx-auto px-4 md:px-8 space-y-10" id="editorial-features">
              <div className="text-center max-w-xl mx-auto">
                <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase">{t('feat.badge')}</span>
                <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight mt-1">{t('feat.title')}</h2>
                <p className="text-xs font-mono text-brand-text-muted mt-1">{t('feat.subtitle')}</p>
              </div>

              {/* 6 Feature modular grids exactly mapped to brief */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {CORE_FEATURES.map((feature, idx) => {
                  return (
                    <div 
                      key={feature.id} 
                      id={`feature-card-${feature.id}`}
                      className="p-6 bg-brand-bg-card border border-brand-border rounded-xl transition-all duration-300 hover:shadow-xs hover:translate-y-[-1px] space-y-3.5 flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        {/* High-contrast vector bullet markers */}
                        <div className="h-9 w-9 bg-brand-bg-primary rounded-lg border border-brand-border flex items-center justify-center text-brand-caramel shrink-0">
                          {feature.icon === 'Monitor' && <Monitor size={18} />}
                          {feature.icon === 'Bot' && <Bot size={18} />}
                          {feature.icon === 'Layers' && <Layers size={18} />}
                          {feature.icon === 'Shield' && <Shield size={18} />}
                          {feature.icon === 'Wrench' && <Wrench size={18} />}
                          {feature.icon === 'Cpu' && <Cpu size={18} />}
                        </div>
                        <h4 className="text-base serif-display font-bold text-brand-text-title">
                          {feature.title}
                        </h4>
                        <p className="text-xs leading-relaxed text-brand-text-muted font-sans my-2">
                          {feature.description}
                        </p>
                      </div>
                      
                      {/* Interactive Deep Spec routing connectors */}
                      <button 
                        onClick={() => {
                          if (feature.id === 'monitor') jumpToSimulatorTab('main');
                          else if (feature.id === 'computeruse') jumpToSimulatorTab('computer');
                          else if (feature.id === 'multiprovider') jumpToSimulatorTab('provider');
                          else if (feature.id === 'security') jumpToSimulatorTab('provider');
                          else if (feature.id === 'mcp') jumpToSimulatorTab('skills');
                          else if (feature.id === 'rustcore') jumpToSimulatorTab('computer');
                        }}
                        className="text-[10px] font-mono font-bold text-brand-caramel hover:underline text-left inline-flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>{t('feat.btn.sim')}</span>
                        <ChevronRight size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* SECTION 4: SETTINGS SCREEN DEEP INTEGRATIONS */}
            <section className="bg-[#efe8de]/30 border-y border-brand-border py-16">
              <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-12">
                <div className="text-center max-w-xl mx-auto">
                  <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase font-bold">{t('setting.badge')}</span>
                  <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight mt-1">{t('setting.title')}</h2>
                  <p className="text-xs font-mono text-brand-text-muted mt-1">
                    {t('setting.subtitle')}
                  </p>
                </div>

                {/* Elegant listing columns showing setting screenshots with links */}
                <div className="max-w-4xl mx-auto space-y-10">
                  {SETTINGS_SHOWCASES.map((item, index) => {
                    const isEven = index % 2 === 0;
                    return (
                      <div 
                        key={item.id}
                        className={`flex flex-col lg:flex-row items-stretch border border-brand-border rounded-xl bg-brand-bg-primary overflow-hidden shadow-2xs hover:shadow-xs transition duration-300 ${isEven ? '' : 'lg:flex-row-reverse'}`}
                      >
                        {/* Text explanation width bounded strictly to 65ch */}
                        <div className="p-6 md:p-8 flex-1 flex flex-col justify-between space-y-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-brand-caramel/10 text-brand-caramel rounded border border-brand-caramel/20">
                                {item.badge}
                              </span>
                              <div className="flex gap-1">
                                {item.tags.map(t => (
                                  <span key={t} className="text-[9px] font-mono text-brand-text-muted">#{t}</span>
                                ))}
                              </div>
                            </div>
                            <h4 className="text-lg md:text-xl serif-display font-bold text-brand-text-title">
                              {item.title}
                            </h4>
                            <p className="text-xs md:text-sm leading-relaxed text-brand-text-muted">
                              {item.description}
                            </p>
                          </div>

                          <div className="pt-2">
                            <button 
                              onClick={() => {
                                if (item.id === 'setting_provider') jumpToSimulatorTab('provider');
                                else if (item.id === 'setting_computeruse') jumpToSimulatorTab('computer');
                                else if (item.id === 'setting_skills') jumpToSimulatorTab('skills');
                              }}
                              className="px-4 py-2 bg-brand-bg-secondary hover:bg-brand-bg-card text-brand-text-title border border-brand-border rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition duration-200 cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                            >
                              <span>{t('setting.btn.sim')}</span>
                              <ArrowRight size={12} className="text-brand-caramel" />
                            </button>
                          </div>
                        </div>

                        {/* Real screenshot */}
                        <div className="w-full lg:w-[400px] bg-brand-bg-secondary border-t lg:border-t-0 lg:border-l border-brand-border shrink-0 select-none overflow-hidden">
                          <img
                            src={item.imagePath}
                            alt={item.title}
                            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300 cursor-pointer"
                            onClick={() => {
                              if (item.id === 'setting_provider') jumpToSimulatorTab('provider');
                              else if (item.id === 'setting_computeruse') jumpToSimulatorTab('computer');
                              else if (item.id === 'setting_skills') jumpToSimulatorTab('skills');
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* SECTION 5: TECHNICAL ARCHITECTURE */}
            <section className="max-w-7xl mx-auto px-4 md:px-8 space-y-10" id="editorial-architecture">
              <div className="text-center max-w-xl mx-auto">
                <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase">{t('arch.badge')}</span>
                <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight mt-1">{t('arch.title')}</h2>
                <p className="text-xs font-mono text-brand-text-muted mt-1">{t('arch.subtitle')}</p>
              </div>

              {/* Graphical technical tree diagram representation in high-contrast editorial look */}
              <div className="max-w-4xl mx-auto bg-brand-bg-card p-6 md:p-8 border border-brand-border rounded-2xl space-y-6">
                
                {/* Visualizer Schema Flow Graph */}
                <div className="hidden sm:grid grid-cols-4 gap-2 text-center text-[10px] font-mono font-bold tracking-wider relative select-none">
                  
                  {/* Arrows connectors mockup background CSS */}
                  <div className="p-3 bg-brand-bg-primary rounded-lg border border-brand-border shadow-2xs">
                    <span className="text-brand-caramel">{t('arch.ch.one')}</span>
                    <p className="text-[9px] text-brand-text-muted font-normal mt-1 leading-snug">React 18 + xterm.js</p>
                  </div>
                  
                  <div className="p-3 bg-brand-bg-primary rounded-lg border border-brand-border shadow-2xs">
                    <span className="text-brand-caramel">{t('arch.ch.two')}</span>
                    <p className="text-[9px] text-brand-text-muted font-normal mt-1 leading-snug">IPC 守护 ‹ 1ms 时延</p>
                  </div>

                  <div className="p-3 bg-brand-bg-primary rounded-lg border border-brand-border shadow-2xs">
                    <span className="text-brand-caramel">{t('arch.ch.three')}</span>
                    <p className="text-[9px] text-brand-text-muted font-normal mt-1 leading-snug">AST 高效分析套件</p>
                  </div>

                  <div className="p-3 bg-brand-bg-primary rounded-lg border border-brand-border shadow-2xs">
                    <span className="text-brand-caramel">{t('arch.ch.four')}</span>
                    <p className="text-[9px] text-brand-text-muted font-normal mt-1 leading-snug">DeepSeek / Claude</p>
                  </div>
                </div>

                {/* Structured detailed text checklist */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs pt-4 border-t border-brand-border/40">
                  {ARCHITECTURE_LAYERS.map((layer, index) => (
                    <div key={index} className="p-4 bg-brand-bg-primary border border-brand-border rounded-xl space-y-1.5 hover:border-brand-caramel/40 transition-colors">
                      <div className="flex items-center gap-1.5 font-bold text-brand-text-title text-[13px]">
                        <span>{layer.title}</span>
                      </div>
                      <div className="text-[10px] text-brand-caramel font-semibold">{t('arch.tech_stack')}: {layer.tech}</div>
                      <p className="text-[11px] text-brand-text-muted leading-relaxed font-sans">{layer.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* SECTION 6: PERFORMANCE OPTIMIZATION (14-POINT BENCHMARK SCORECARDS) */}
            <section className="bg-[#efe8de]/50 border-y border-brand-border py-16" id="performance-benchmark">
              <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-10">
                <div className="text-center max-w-xl mx-auto">
                  <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase">{t('bench.badge')}</span>
                  <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight mt-1">{t('bench.title')}</h2>
                  <p className="text-xs font-mono text-brand-text-muted mt-1">{t('bench.subtitle')}</p>
                </div>

                {/* Category selectors for Benchmarks */}
                <div className="flex justify-center gap-1.5 p-1 bg-brand-bg-primary border border-brand-border rounded-lg max-w-md mx-auto text-xs font-mono select-none">
                  {[
                    { id: 'all', label: t('bench.cat.all') },
                    { id: 'performance', label: t('bench.cat.perf') },
                    { id: 'resource', label: t('bench.cat.res') },
                    { id: 'ux', label: t('bench.cat.ux') }
                  ].map((cat) => (
                    <button 
                      key={cat.id}
                      onClick={() => setSelectedBenchmarkCat(cat.id as any)}
                      className={`px-3 py-1 rounded transition-colors font-medium cursor-pointer ${selectedBenchmarkCat === cat.id ? 'bg-brand-caramel text-brand-bg-primary font-bold' : 'text-brand-text-muted hover:text-brand-text-title'}`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Grid layout containing filterable benchmarks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
                  {filteredBenchmarks.map((b, bIdx) => (
                    <div 
                      key={bIdx}
                      className="p-4 bg-brand-bg-primary border border-brand-border rounded-xl font-mono text-xs space-y-2 border-l-2 border-l-brand-caramel"
                    >
                      <div className="text-[10px] text-brand-text-muted uppercase tracking-wider">
                        {b.category === 'performance' ? t('bench.cat.perf.badge') : b.category === 'resource' ? t('bench.cat.res.badge') : t('bench.cat.ux.badge')}
                      </div>
                      <h5 className="font-bold text-brand-text-title text-[13px] truncate" title={lang === 'zh' ? b.metric : b.metric_en}>
                        {lang === 'zh' ? b.metric : b.metric_en}
                      </h5>
                      <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                        <div>
                          <span className="text-brand-text-muted block">DreamCoder</span>
                          <span className="font-extrabold text-brand-success text-sm block mt-0.5">{b.dreamcoder}</span>
                        </div>
                        <div>
                          <span className="text-brand-text-muted block">{t('bench.competitor')}</span>
                          <span className="font-semibold text-brand-text-muted block mt-1">{b.competitor}</span>
                        </div>
                      </div>
                      <div className="pt-1.5 border-t border-brand-border/40 flex items-center justify-between text-[10px] text-brand-caramel font-bold">
                        <span>{t('bench.benefit')}</span>
                        <span>{b.improvement}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* SECTION 7: CALL TO ACTION END AREA */}
            <section className="max-w-xl mx-auto px-4 md:px-8 text-center space-y-6" id="landing-footer-cta">
              <h2 className="text-3xl serif-display font-medium text-brand-text-title tracking-tight font-bold selection:bg-brand-caramel/10">
                {t('cta.title')}
              </h2>
              <p className="text-xs md:text-sm leading-relaxed text-brand-text-muted max-w-[50ch] mx-auto select-text selection:bg-brand-caramel/10">
                {t('cta.desc')}
              </p>
              
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2 font-mono">
                <a
                  href="https://github.com/GoDiao/dreamcoder/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="px-6 py-3 bg-brand-caramel hover:bg-brand-caramel/90 text-brand-bg-primary text-xs font-bold rounded-xl transition duration-200 cursor-pointer shadow-xs hover:shadow-md hover:translate-y-[-1px] flex items-center gap-2"
                >
                  <Download size={13} />
                  {t('cta.btn.dl')}
                </a>
                <a 
                  href="https://github.com/GoDiao/dreamcoder" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="px-6 py-3 bg-white hover:bg-brand-bg-card text-brand-text-title border border-brand-border text-xs font-bold rounded-xl transition duration-200 cursor-pointer shadow-xs hover:shadow-md hover:translate-y-[-1px] flex items-center gap-1.5"
                >
                  <Github size={13} />
                  <span>{t('cta.btn.git')}</span>
                </a>
              </div>
            </section>
          </div>
        )}

        {/* ==================== PAGE 2: CORE DOCUMENTATION VIEW ==================== */}
        {currentPage === 'docs' && (
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 animate-fade-in" id="docs-page-parent">
            {/* Embedded modular Docs Section components */}
            <DocsSection />
          </div>
        )}

        {/* ==================== PAGE 3: COMPONENT DESIGN SPECIFICATIONS ==================== */}
        {currentPage === 'spec' && (
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 animate-fade-in" id="spec-page-parent">
            {/* Embedded interactive Design token Specs */}
            <DesignSpec />
          </div>
        )}
      </main>

      {/* SECTION 8: GLOBAL FOOTER */}
      <footer className="bg-brand-bg-secondary border-t border-brand-border py-12 select-none text-[11px] font-mono">
        <div className="max-w-7xl mx-auto px-4 md:px-8 text-brand-text-muted space-y-8">
          
          {/* Main detailed grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <h5 className="font-bold text-brand-text-title text-xs">{t('footer.about.title')}</h5>
              <p className="font-sans leading-relaxed text-[11px] text-[#75716f] max-w-[200px]">
                {t('footer.about.desc')}
              </p>
            </div>
            
            <div className="space-y-2">
              <h5 className="font-bold text-brand-text-title text-xs">{t('footer.sub.title')}</h5>
              <ul className="space-y-1.5 text-[11.5px]">
                <li>
                  <button onClick={() => setCurrentPage('docs')} className="hover:text-brand-caramel cursor-pointer text-left">{t('footer.sub.item1')}</button>
                </li>
                <li>
                  <button onClick={() => setCurrentPage('docs')} className="hover:text-brand-caramel cursor-pointer text-left">{t('footer.sub.item2')}</button>
                </li>
                <li>
                  <button onClick={() => setCurrentPage('docs')} className="hover:text-brand-caramel cursor-pointer text-left">{t('footer.sub.item3')}</button>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h5 className="font-bold text-brand-text-title text-xs">{t('footer.dev.title')}</h5>
              <ul className="space-y-1.5 text-[11.5px]">
                <li>
                  <a href="https://github.com/GoDiao/dreamcoder" target="_blank" rel="noreferrer" className="hover:text-brand-caramel">{t('footer.dev.item1')}</a>
                </li>
                <li>
                  <a href="https://github.com/GoDiao/dreamcoder/issues" target="_blank" rel="noreferrer" className="hover:text-brand-caramel">{t('footer.dev.item2')}</a>
                </li>
                <li>
                  <button onClick={() => setCurrentPage('spec')} className="hover:text-brand-caramel cursor-pointer text-left">{t('footer.dev.item3')}</button>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h5 className="font-bold text-brand-text-title text-xs">{t('footer.sec.title')}</h5>
              <p className="font-sans leading-relaxed text-[11px] text-[#75716f]">
                {t('footer.sec.desc')}
              </p>
            </div>
          </div>

          {/* Licensing and metadata row */}
          <div className="pt-6 border-t border-brand-border/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-center">
            <div>
              <span>© 2026 DreamCoder Open Source Group. Open Source licensed under the MIT License.</span>
            </div>
            <div className="flex items-center gap-3">
              <a href="https://github.com/GoDiao/dreamcoder" target="_blank" rel="noreferrer" className="hover:text-brand-caramel inline-flex items-center gap-1">
                <Github size={11} />
                <span>GitHub</span>
              </a>
              <span className="text-brand-border">|</span>
              <a href="https://godiao.github.io/dreamcoder/" target="_blank" rel="noreferrer" className="hover:text-brand-caramel inline-flex items-center gap-0.5">
                <span>{t('footer.preview')}</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
