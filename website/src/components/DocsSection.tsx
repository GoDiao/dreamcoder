import React, { useState, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { DocArticle } from '../types';
import { 
  BookOpen, Search, Copy, Check, ChevronRight, Hash, ArrowUpRight, 
  HelpCircle, MessageSquare, ShieldAlert, Cpu, Wrench, Menu, X, Info
} from 'lucide-react';

export default function DocsSection() {
  const { lang, t, DOC_ARTICLES } = useLanguage();
  const [selectedDocId, setSelectedDocId] = useState<string>('quickstart');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Filter articles based on search
  const filteredDocs = useMemo(() => {
    if (!searchQuery) return DOC_ARTICLES;
    return DOC_ARTICLES.filter(doc => 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      doc.summary.toLowerCase().includes(searchQuery.toLowerCase()) || 
      doc.content.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, DOC_ARTICLES]);

  // Current active document
  const activeDoc = useMemo(() => {
    return DOC_ARTICLES.find(doc => doc.id === selectedDocId) || DOC_ARTICLES[0];
  }, [selectedDocId, DOC_ARTICLES]);

  // Extract headings from active document for the right TOC (Table of Contents)
  const docHeadings = useMemo(() => {
    const lines = activeDoc.content.split('\n');
    const headings: { text: string; id: string; level: number }[] = [];
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('#### ')) {
        const text = trimmedLine.replace('#### ', '').trim();
        headings.push({ text, id: text.toLowerCase().replace(/\s+/g, '-'), level: 4 });
      } else if (trimmedLine.startsWith('### ')) {
        const text = trimmedLine.replace('### ', '').trim();
        headings.push({ text, id: text.toLowerCase().replace(/\s+/g, '-'), level: 3 });
      } else if (trimmedLine.startsWith('## ')) {
        const text = trimmedLine.replace('## ', '').trim();
        headings.push({ text, id: text.toLowerCase().replace(/\s+/g, '-'), level: 2 });
      } else if (trimmedLine.startsWith('# ')) {
        const text = trimmedLine.replace('# ', '').trim();
        headings.push({ text, id: text.toLowerCase().replace(/\s+/g, '-'), level: 1 });
      }
    });
    
    return headings;
  }, [activeDoc]);

  // Handle code copies
  const triggerCopyCode = (codeText: string, blockId: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedId(blockId);
    setTimeout(() => {
      setCopiedId(null);
    }, 1500);
  };

  // Group documentation by categories for nested sidebar
  const categoriesMap = useMemo(() => {
    const map: Record<string, DocArticle[]> = {};
    filteredDocs.forEach(doc => {
      if (!map[doc.category]) {
        map[doc.category] = [];
      }
      map[doc.category].push(doc);
    });
    return map;
  }, [filteredDocs]);

  // Interface representing parsed block structure
  interface MarkdownBlock {
    type: 'heading' | 'code' | 'blockquote' | 'list' | 'hr' | 'paragraph' | 'empty';
    level?: number;
    text?: string;
    language?: string;
    code?: string;
    lines?: string[];
    items?: { text: string; listType: 'unordered' | 'ordered'; indent: number; numIndex?: number }[];
  }

  // Helper formatting scanner for formatting inline tags such as `code` and **bold** inside text strings
  const renderInline = (str: string): React.ReactNode[] => {
    if (!str) return [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    const splitParts = str.split(regex);
    
    return splitParts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        const codeText = part.slice(1, -1);
        return (
          <code key={i} className="px-1.5 py-0.5 mx-0.5 rounded bg-[#efe8de] text-[#b87351] font-mono text-xs border border-[#dad4c8] font-semibold">
            {codeText}
          </code>
        );
      } else if (part.startsWith('**') && part.endsWith('**')) {
        const boldText = part.slice(2, -2);
        return <strong key={i} className="font-bold text-[#1a1816]">{boldText}</strong>;
      } else if (part.startsWith('*') && part.endsWith('*')) {
        const italicText = part.slice(1, -1);
        return <em key={i} className="italic">{italicText}</em>;
      } else {
        return part;
      }
    });
  };

  // High quality helper parser to translate a markdown document into rich nested React blocks
  const renderRichDocContent = (markdownText: string) => {
    const lines = markdownText.split('\n');
    const blocks: MarkdownBlock[] = [];
    let i = 0;

    // Phase 1: Group lines into parsed MarkdownBlocks
    while (i < lines.length) {
      const line = lines[i];

      // Code blocks selector
      if (line.trim().startsWith('```')) {
        const language = line.trim().replace('```', '').trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        blocks.push({
          type: 'code',
          language: language || 'bash',
          code: codeLines.join('\n')
        });
        continue;
      }

      const trimmed = line.trim();

      // Heading block
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (match) {
          blocks.push({
            type: 'heading',
            level: match[1].length,
            text: match[2].trim()
          });
          i++;
          continue;
        }
      }

      // Horizontal lines Selector
      if (trimmed === '---') {
        blocks.push({ type: 'hr' });
        i++;
        continue;
      }

      // Blockquotes Selector
      if (line.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('>')) {
          quoteLines.push(lines[i].substring(1).trim());
          i++;
        }
        blocks.push({ type: 'blockquote', lines: quoteLines });
        continue;
      }

      // Continuous Lists Collector (matches unordered or ordered tags)
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const items: { text: string; listType: 'unordered' | 'ordered'; indent: number; numIndex?: number }[] = [];
        while (i < lines.length) {
          const currentLine = lines[i];
          const match = currentLine.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (!match) break;
          
          const indentSpaces = match[1].length;
          const marker = match[2];
          const text = match[3];
          const listType = /^\d+/.test(marker) ? 'ordered' : 'unordered';
          const numIndex = listType === 'ordered' ? parseInt(marker, 10) : undefined;
          
          items.push({
            text,
            listType,
            indent: Math.floor(indentSpaces / 2),
            numIndex
          });
          i++;
        }
        blocks.push({ type: 'list', items });
        continue;
      }

      // Empty spacing Lines
      if (trimmed === '') {
        blocks.push({ type: 'empty' });
        i++;
        continue;
      }

      // Plain paragraphs and multi-line normal texts
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('```') &&
        !lines[i].trim().startsWith('---') &&
        !lines[i].startsWith('>') &&
        !lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
      ) {
        paraLines.push(lines[i].trim());
        i++;
      }
      blocks.push({ type: 'paragraph', lines: paraLines });
    }

    // Phase 2: Convert grouped MarkdownBlocks to Tailwind React Vibe DOM Elements
    return blocks.map((block, idx) => {
      switch (block.type) {
        case 'heading': {
          const text = block.text || '';
          const level = block.level || 4;
          const idStr = text.toLowerCase().replace(/\s+/g, '-');
          
          if (level === 1) {
            return (
              <h1 key={idx} id={idStr} className="text-2xl md:text-3xl font-serif font-bold text-[#1a1816] tracking-tight mt-8 mb-4 pb-2 border-b border-[#dad4c8]">
                {renderInline(text)}
              </h1>
            );
          } else if (level === 2) {
            return (
              <h2 key={idx} id={idStr} className="text-xl md:text-2xl font-serif font-semibold text-[#1a1816] mt-8 mb-3 flex items-center gap-1.5 scroll-mt-16">
                <Hash size={16} className="text-[#b87351]/40 shrink-0" />
                {renderInline(text)}
              </h2>
            );
          } else if (level === 3) {
            return (
              <h3 key={idx} id={idStr} className="text-lg font-serif font-bold text-[#1a1816] mt-6 mb-2">
                {renderInline(text)}
              </h3>
            );
          } else {
            return (
              <h4 key={idx} id={idStr} className="text-sm md:text-base font-serif font-bold text-[#100f0e] mt-5 mb-2 pl-2 border-l-2 border-[#b87351]/80">
                {renderInline(text)}
              </h4>
            );
          }
        }

        case 'code': {
          const randomBlockId = `code-block-${idx}`;
          const fullCode = block.code || '';
          return (
            <div key={idx} id={randomBlockId} className="my-5 relative group border border-[#dad4c8] rounded-xl bg-[#efe8de]/40 overflow-hidden font-mono text-[13px] leading-snug">
              <div className="flex items-center justify-between px-4 py-2 bg-[#efe8de] border-b border-[#dad4c8] text-[10px] text-[#75716f] select-none font-bold tracking-wider uppercase">
                <span>{block.language || 'source'}</span>
                <button
                  type="button"
                  onClick={() => triggerCopyCode(fullCode, randomBlockId)}
                  className="hover:text-[#b87351] flex items-center gap-1 font-bold pointer-events-auto transition-colors cursor-pointer"
                >
                  {copiedId === randomBlockId ? (
                    <>
                      <Check size={11} className="text-brand-success" />
                      <span className="text-brand-success font-semibold">{lang === 'zh' ? '已复制' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>{lang === 'zh' ? '复制代码' : 'Copy Code'}</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 overflow-x-auto text-[#1a1816] select-text">
                <code>{fullCode}</code>
              </pre>
            </div>
          );
        }

        case 'blockquote': {
          const blockLines = block.lines || [];
          return (
            <blockquote key={idx} className="my-4 p-4 bg-[#efe8de]/40 border-l-4 border-[#b87351] text-xs md:text-sm text-[#75716f] italic rounded-r leading-relaxed">
              {blockLines.map((lineText, lIdx) => (
                <p key={lIdx} className={lIdx > 0 ? 'mt-2' : ''}>
                  {renderInline(lineText)}
                </p>
              ))}
            </blockquote>
          );
        }

        case 'list': {
          const listItems = block.items || [];
          return (
            <div key={idx} className="my-3.5 space-y-1">
              {listItems.map((item, itemIdx) => {
                const indentClass = item.indent === 1 ? 'pl-5' : item.indent >= 2 ? 'pl-10' : '';
                const marker = item.listType === 'ordered' ? (
                  <span className="text-[#b87351] font-mono font-bold mr-2 shrink-0">{item.numIndex ?? (itemIdx + 1)}.</span>
                ) : (
                  <span className="text-[#b87351] mr-2.5 select-none font-extrabold shrink-0">•</span>
                );

                // Highlight definitions if list item structure matches standard bold term: **Term**：Definition
                const termDefMatch = item.text.match(/^\s*\*\*([^*]+)\*\*\s*[:：]\s*(.*)$/);
                if (termDefMatch) {
                  return (
                    <div key={itemIdx} className={`${indentClass} flex items-start text-xs md:text-sm text-[#4a4845] py-0.5`}>
                      {marker}
                      <div className="flex-1 leading-relaxed">
                        <strong className="text-[#1a1816] font-bold text-xs md:text-sm">{termDefMatch[1]}</strong>：
                        {renderInline(termDefMatch[2])}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={itemIdx} className={`${indentClass} flex items-start text-xs md:text-sm text-[#4a4845] py-0.5`}>
                    {marker}
                    <div className="flex-1 leading-relaxed">
                      {renderInline(item.text)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        case 'hr':
          return <hr key={idx} className="my-6 border-b border-[#dad4c8]" />;

        case 'paragraph': {
          const contentStr = (block.lines || []).join(' ');
          return (
            <p key={idx} className="text-xs md:text-sm leading-relaxed text-[#4a4845] mb-3">
              {renderInline(contentStr)}
            </p>
          );
        }

        case 'empty':
          return <div key={idx} className="h-1.5" />;

        default:
          return null;
      }
    });
  };

  return (
    <div className="w-full bg-brand-bg-primary border border-brand-border rounded-2xl p-4 md:p-8 shadow-xs">
      
      {/* Search Header and Mobile view trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-brand-border">
        <div>
          <div className="flex items-center gap-12 sm:gap-2 mb-1">
            <button 
              onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
              className="lg:hidden flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 bg-brand-bg-secondary border border-brand-border rounded-lg text-brand-text-title cursor-pointer"
            >
              <Menu size={14} />
              {lang === 'zh' ? '目录导航' : 'Navigation'}
            </button>
            <span className="text-xs font-mono font-semibold text-brand-caramel tracking-wider uppercase">DreamCoder Docusaurus Docs</span>
          </div>
          <h2 className="text-2xl md:text-3xl serif-display text-brand-text-title tracking-tight font-semibold">
            {lang === 'zh' ? '书页级技术手册' : 'Desktop User Manual'}
          </h2>
        </div>

        {/* Global Search Doc Input */}
        <div className="relative w-full sm:w-72">
          <input 
            type="text" 
            placeholder={lang === 'zh' ? '搜索技术文献...' : 'Search documentation...'} 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-2 pl-8 bg-brand-bg-secondary/60 border border-brand-border rounded-lg text-xs focus:outline-hidden font-mono focus:ring-1 focus:ring-brand-caramel"
          />
          <Search size={13} className="absolute left-2.5 top-3 text-brand-text-muted" />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')} 
              className="absolute right-2.5 top-2.5 hover:text-brand-caramel font-mono text-[10px] text-brand-text-muted font-bold"
            >
              {lang === 'zh' ? '清除' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {/* Main split dashboard section */}
      <div className="flex flex-col lg:flex-row items-stretch gap-6 md:gap-8 mt-6 relative">
        
        {/* MOBIL MENU OVERLAY PANEL */}
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 bg-brand-text-title/50 z-40 lg:hidden animate-fade-in" onClick={() => setIsMobileSidebarOpen(false)}>
            <div className="absolute top-0 left-0 w-72 h-full bg-brand-bg-primary p-5 border-r border-brand-border flex flex-col space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-3 border-b border-brand-border">
                <span className="font-serif font-bold text-brand-text-title">
                  {lang === 'zh' ? '技术指南 目录' : 'Technical Manual TOC'}
                </span>
                <button onClick={() => setIsMobileSidebarOpen(false)} className="text-brand-text-muted hover:text-brand-caramel">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 font-mono text-xs">
                {(Object.entries(categoriesMap) as [string, DocArticle[]][]).map(([cat, docs]) => (
                  <div key={cat} className="space-y-1">
                    <span className="text-[10px] text-brand-text-muted font-bold tracking-wider uppercase">{cat}</span>
                    <div className="space-y-0.5">
                      {docs.map(doc => (
                        <button
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocId(doc.id);
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full text-left p-2 rounded-md transition-colors flex items-center justify-between ${selectedDocId === doc.id ? 'bg-brand-bg-secondary/80 text-brand-caramel font-bold' : 'hover:bg-brand-bg-secondary/40 text-brand-text-body'}`}
                        >
                          <span className="truncate">{doc.title.replace(' Quick Start', '')}</span>
                          <ChevronRight size={10} className="shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* LEFT COLUMN: DESKTOP STICKY INDEX (width 250px) */}
        <div className="hidden lg:block w-[240px] shrink-0 sticky top-10 font-mono text-xs select-none">
          <div className="space-y-5">
            <div className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest pb-1.5 border-b border-brand-border/60">
              DOCUMENTATION INDEX
            </div>
            
            <div className="space-y-4">
              {Object.keys(categoriesMap).length === 0 ? (
                <div className="text-brand-text-muted italic p-2">
                  {lang === 'zh' ? '未筛选到匹配文章' : 'No matching articles found'}
                </div>
              ) : (
                (Object.entries(categoriesMap) as [string, DocArticle[]][]).map(([cat, docs]) => (
                  <div key={cat} className="space-y-1">
                    <div className="text-[9px] font-bold text-brand-text-muted tracking-wider uppercase px-2">
                      {cat}
                    </div>
                    <div className="space-y-0.5">
                      {docs.map(doc => {
                        const isActive = doc.id === selectedDocId;
                        return (
                          <button
                            key={doc.id}
                            id={`sidebar-link-${doc.id}`}
                            onClick={() => setSelectedDocId(doc.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-all text-[11px] font-medium flex items-center justify-between ${isActive ? 'bg-brand-bg-card/70 text-brand-caramel border-l-2 border-brand-caramel pl-2.5 font-bold shadow-2xs' : 'hover:bg-brand-bg-secondary/40 text-brand-text-body'}`}
                          >
                            <span className="truncate pr-1">{doc.title.split(' ')[0]}</span>
                            <ChevronRight size={10} className={`shrink-0 transition-transform ${isActive ? 'rotate-90 text-brand-caramel' : 'text-brand-text-muted'}`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Offline persistence tip box */}
            <div className="p-3.5 bg-brand-bg-secondary/50 border border-brand-border rounded-xl space-y-1.5 mt-5">
              <span className="font-semibold text-brand-text-title text-[10px] flex items-center gap-1">
                <BookOpen size={11} className="text-brand-caramel" />
                {lang === 'zh' ? '本地离线手册配套' : 'Offline Manual Companion'}
              </span>
              <p className="text-[10px] text-brand-text-muted leading-relaxed">
                {lang === 'zh' 
                  ? 'DreamCoder 内置本套极速参考，甚至在一万米万米高空的航空离线环境中，亦可毫秒响应查阅。' 
                  : 'DreamCoder ships with this high-speed manual pre-loaded, giving you sub-millisecond offline lookup response even at 30,000 feet in the air.'}
              </p>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: ACTIVE ARTICLE TEXT LAYER (max-width 65ch) */}
        <div className="flex-1 min-w-0" id="editorial-reading-pane">
          <div className="max-w-[65ch] mx-auto prose prose-neutral">
            
            {/* Category Tag */}
            <span className="inline-block px-2.5 py-0.5 border border-brand-border/80 bg-brand-bg-secondary text-brand-caramel font-mono text-[10px] font-bold uppercase tracking-wider rounded">
              {activeDoc.category}
            </span>

            {/* Title summary */}
            <p className="text-xs md:text-sm italic text-brand-text-muted mt-3 mb-6 bg-brand-bg-secondary/20 p-3 rounded-lg border-l-2 border-brand-highlight/65 font-mono select-none">
              {lang === 'zh' ? '摘要提示：' : 'Summary: '}{activeDoc.summary}
            </p>

            {/* Rendered markdown contents with styled typography */}
            <div className="select-text entry-content-editorial">
              {renderRichDocContent(activeDoc.content)}
            </div>

            {/* Prev/Next Navigation Trigger footer */}
            <div className="mt-12 pt-6 border-t border-brand-border flex justify-between items-center text-xs font-mono">
              <button
                disabled={DOC_ARTICLES.findIndex(d => d.id === selectedDocId) === 0}
                onClick={() => {
                  const currIdx = DOC_ARTICLES.findIndex(d => d.id === selectedDocId);
                  if (currIdx > 0) setSelectedDocId(DOC_ARTICLES[currIdx - 1].id);
                }}
                className="px-3 py-1.5 bg-brand-bg-secondary hover:bg-brand-bg-card text-brand-text-title border border-brand-border rounded-lg disabled:opacity-40 transition-colors shrink-0 font-bold"
              >
                {lang === 'zh' ? '← 上一篇' : '← Previous'}
              </button>
              
              <span className="text-[10px] text-brand-text-muted hidden sm:inline">
                {lang === 'zh' ? 'DreamCoder v0.3.0 技术分册' : 'DreamCoder v0.3.0 Technical Manual'}
              </span>

              <button
                disabled={DOC_ARTICLES.findIndex(d => d.id === selectedDocId) === DOC_ARTICLES.length - 1}
                onClick={() => {
                  const currIdx = DOC_ARTICLES.findIndex(d => d.id === selectedDocId);
                  if (currIdx < DOC_ARTICLES.length - 1) setSelectedDocId(DOC_ARTICLES[currIdx + 1].id);
                }}
                className="px-3 py-1.5 bg-brand-bg-secondary hover:bg-brand-bg-card text-brand-text-title border border-brand-border rounded-lg disabled:opacity-40 transition-colors shrink-0 font-bold"
              >
                {lang === 'zh' ? '下一篇 →' : 'Next →'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: HEADINGS TOC OUTLINE (TOC sticky, hidden on small layout) */}
        <div className="hidden xl:block w-[180px] shrink-0 sticky top-10 font-mono text-[11px] self-start border-l border-brand-border/60 pl-4 select-none">
          <div className="space-y-3">
            <div className="text-[9px] font-bold text-brand-text-muted tracking-widest uppercase">
              ON THIS PAGE
            </div>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {docHeadings.map((heading, hIdx) => (
                <a
                  key={hIdx}
                  href={`#${heading.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`block transition-all hover:text-brand-caramel ${heading.level === 1 ? 'font-bold text-brand-text-title mt-2 text-[11px]' : heading.level === 2 ? 'pl-2 text-brand-text-muted before:content-["#"] before:text-brand-caramel/40 before:mr-1' : 'pl-4 text-brand-text-muted border-l border-brand-border/40'}`}
                >
                  {heading.text}
                </a>
              ))}
            </div>

            <div className="pt-4 border-t border-brand-border/60 space-y-2 mt-4 text-[10px] text-brand-text-muted">
              <a href="https://github.com/GoDiao/dreamcoder/issues" target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-brand-caramel transition-colors">
                <span>{lang === 'zh' ? '纠错 / 提交修改' : 'Suggest Edits'}</span>
                <ArrowUpRight size={10} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
