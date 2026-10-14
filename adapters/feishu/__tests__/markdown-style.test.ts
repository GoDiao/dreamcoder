import { describe, it, expect } from 'bun:test'
import {
  optimizeMarkdownForFeishu,
  sanitizeTextForCard,
  findMarkdownTablesOutsideCodeBlocks,
  FEISHU_CARD_TABLE_LIMIT,
} from '../markdown-style.js'

const opt = (text: string, v?: number) => optimizeMarkdownForFeishu(text, v)

describe('optimizeMarkdownForFeishu: 标题降级', () => {
  it('H1 → H4 (cardVersion=1 简化检查)', () => {
    expect(opt('# Title', 1)).toBe('#### Title')
  })

  it('H2 → H5 (cardVersion=1)', () => {
    expect(opt('## Title', 1)).toBe('##### Title')
  })

  it('H3 → H5 (cardVersion=1)', () => {
    expect(opt('### Title', 1)).toBe('##### Title')
  })

  it('混合 H1+H2+H3 全部降级 (cardVersion=1)', () => {
    expect(opt('# H1\n## H2\n### H3', 1)).toBe('#### H1\n##### H2\n##### H3')
  })

  it('纯 H4 文档不触发降级 (cardVersion=1)', () => {
    expect(opt('#### Already H4', 1)).toBe('#### Already H4')
  })

  it('同时存在 H1 和 H4: H1→H4, 原 H4 → H5 (cardVersion=1)', () => {
    expect(opt('# Top\n#### Sub', 1)).toBe('#### Top\n##### Sub')
  })

  it('# 后必须有空格才算标题', () => {
    expect(opt('#notaheading', 1)).toBe('#notaheading')
  })

  it('顺序保证: # 降成 #### 后不会被 #{2,6} 再次吃成 #####', () => {
    expect(opt('# Top', 1)).toBe('#### Top')
  })

  it('无标题文本原样返回', () => {
    expect(opt('just plain text', 1)).toBe('just plain text')
  })

  it('默认 cardVersion=2 下也能正确降级标题', () => {
    const out = opt('# Title')
    expect(out).toContain('#### Title')
    expect(out).not.toMatch(/^# Title$/m)
  })
})

describe('optimizeMarkdownForFeishu: 代码块保护', () => {
  it('代码块内的 # 不被降级 (cardVersion=1)', () => {
    const input = '```\n# not a heading\n## also not\n```'
    expect(opt(input, 1)).toBe(input)
  })

  it('外部 H1 降级，代码块内 # 保持 (cardVersion=1)', () => {
    const input = '# Real heading\n\n```\n# inside code\n```'
    expect(opt(input, 1)).toBe('#### Real heading\n\n```\n# inside code\n```')
  })

  it('语言标记的 fenced 代码块也受保护 (cardVersion=1)', () => {
    const input = '## Section\n\n```python\n# python comment\n### not a heading\n```'
    expect(opt(input, 1)).toBe('##### Section\n\n```python\n# python comment\n### not a heading\n```')
  })

  it('多个代码块按顺序保护与还原 (cardVersion=1)', () => {
    const input = '# A\n```\n# b1\n```\n## C\n```\n### b2\n```'
    expect(opt(input, 1)).toBe('#### A\n```\n# b1\n```\n##### C\n```\n### b2\n```')
  })

  it('默认 cardVersion=2 下代码块内 # 仍受保护（语义断言）', () => {
    const out = opt('# Heading\n\n```\n# inside\n```')
    expect(out).toContain('#### Heading')
    expect(out).toContain('# inside')
    expect(out).toContain('```')
  })
})

describe('optimizeMarkdownForFeishu: 空行压缩', () => {
  it('3 个换行 → 2 个 (cardVersion=1)', () => {
    expect(opt('line1\n\n\nline2', 1)).toBe('line1\n\nline2')
  })

  it('5 个换行 → 2 个 (cardVersion=1)', () => {
    expect(opt('line1\n\n\n\n\nline2', 1)).toBe('line1\n\nline2')
  })

  it('2 个换行保留 (cardVersion=1)', () => {
    expect(opt('line1\n\nline2', 1)).toBe('line1\n\nline2')
  })

  it('代码块内部连续换行被保留 (cardVersion=1)', () => {
    const input = '# Title\n\n```\nline1\n\n\nline2\n```'
    expect(opt(input, 1)).toBe('#### Title\n\n```\nline1\n\n\nline2\n```')
  })
})

describe('optimizeMarkdownForFeishu: Schema 2.0 <br> 间距', () => {
  it('cardVersion=2 默认在代码块前后加 <br>', () => {
    const out = opt('text\n\n```\ncode\n```')
    expect(out).toContain('<br>\n```')
    expect(out).toContain('```\n<br>')
  })

  it('cardVersion=1 代码块前后不加 <br>', () => {
    const out = opt('text\n\n```\ncode\n```', 1)
    expect(out).not.toContain('<br>')
  })

  it('cardVersion=2 连续标题之间加 <br>', () => {
    const out = opt('# A\n# B')
    expect(out).toMatch(/#### A\n<br>\n#### B/)
  })

  it('cardVersion=2 表格前后加 <br>', () => {
    const input = 'text before\n\n| col1 | col2 |\n|------|------|\n| v1 | v2 |\n\ntext after'
    const out = opt(input)
    expect(out).toMatch(/text before\n<br>\n\| col1/)
    expect(out).toMatch(/\| v1 \| v2 \|\n<br>\n\ntext after/)
  })

  it('cardVersion=1 表格前后不加 <br>', () => {
    const input = 'text before\n\n| col1 | col2 |\n|------|------|\n| v1 | v2 |\n\ntext after'
    const out = opt(input, 1)
    expect(out).not.toContain('<br>')
  })

  it('代码块内的 | 不被当表格处理 (Schema 2.0)', () => {
    const input = '```\n| in code | not a table |\n|---|---|\n```'
    const out = opt(input)
    expect(out).toContain('| in code | not a table |')
    expect(out).toMatch(/<br>\n```\n\| in code/)
  })
})

describe('optimizeMarkdownForFeishu: stripInvalidImageKeys', () => {
  it('img_* 图片 key 保留', () => {
    const out = opt('前缀 ![alt](img_abc123) 后缀')
    expect(out).toContain('![alt](img_abc123)')
  })

  it('http:// URL 图片被删除', () => {
    const out = opt('前缀 ![alt](http://example.com/img.png) 后缀')
    expect(out).toBe('前缀  后缀')
  })

  it('https:// URL 图片被删除', () => {
    const out = opt('![a](https://x.y/z.jpg)')
    expect(out).toBe('')
  })

  it('本地路径被删除', () => {
    const out = opt('![a](/Users/me/pic.png)')
    expect(out).toBe('')
  })

  it('无图片文本原样', () => {
    expect(opt('no images here', 1)).toBe('no images here')
  })

  it('混合: img_ 保留，URL 删除', () => {
    const out = opt('![keep](img_good) 和 ![drop](http://bad.com/x.png)')
    expect(out).toContain('![keep](img_good)')
    expect(out).not.toContain('bad.com')
    expect(out).not.toContain('![drop]')
  })
})

describe('findMarkdownTablesOutsideCodeBlocks', () => {
  it('识别单张表格', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |'
    const matches = findMarkdownTablesOutsideCodeBlocks(text)
    expect(matches.length).toBe(1)
    expect(matches[0]!.raw).toContain('| a | b |')
  })

  it('识别多张表格', () => {
    const text =
      '| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\n\n| x | y |\n|---|---|\n| 3 | 4 |'
    const matches = findMarkdownTablesOutsideCodeBlocks(text)
    expect(matches.length).toBe(2)
  })

  it('代码块内的 | 不被算作表格', () => {
    const text = '```\n| in | code |\n|---|---|\n| 1 | 2 |\n```'
    const matches = findMarkdownTablesOutsideCodeBlocks(text)
    expect(matches.length).toBe(0)
  })

  it('代码块 + 外部表格: 只识别外部的', () => {
    const text =
      '```\n| in | code |\n|---|---|\n| 1 | 2 |\n```\n\n| real | table |\n|---|---|\n| a | b |'
    const matches = findMarkdownTablesOutsideCodeBlocks(text)
    expect(matches.length).toBe(1)
    expect(matches[0]!.raw).toContain('real')
  })

  it('无表格文本返回空数组', () => {
    expect(findMarkdownTablesOutsideCodeBlocks('just text').length).toBe(0)
  })
})

describe('sanitizeTextForCard: 表格数量限制', () => {
  function makeTable(label: string): string {
    return `| ${label} h1 | h2 |\n|---|---|\n| v1 | v2 |`
  }

  it('表格数 ≤ 3 时原样返回', () => {
    const text = [makeTable('A'), makeTable('B'), makeTable('C')].join('\n\n')
    expect(sanitizeTextForCard(text)).toBe(text)
  })

  it('恰好 3 张表格原样返回', () => {
    const text = [makeTable('A'), makeTable('B'), makeTable('C')].join('\n\n')
    const matches = findMarkdownTablesOutsideCodeBlocks(text)
    expect(matches.length).toBe(3)
    expect(sanitizeTextForCard(text)).toBe(text)
  })

  it('4 张表格: 前 3 张保留，第 4 张包裹成 code block', () => {
    const text = [makeTable('A'), makeTable('B'), makeTable('C'), makeTable('D')].join('\n\n')
    const out = sanitizeTextForCard(text)
    expect(out).toContain(makeTable('A'))
    expect(out).toContain(makeTable('B'))
    expect(out).toContain(makeTable('C'))
    expect(out).toContain('```\n' + makeTable('D') + '\n```')
  })

  it('自定义 limit=1: 第 1 张保留，之后全部包裹', () => {
    const text = [makeTable('A'), makeTable('B'), makeTable('C')].join('\n\n')
    const out = sanitizeTextForCard(text, 1)
    expect(out).toContain(makeTable('A'))
    expect(out).toContain('```\n' + makeTable('B') + '\n```')
    expect(out).toContain('```\n' + makeTable('C') + '\n```')
  })

  it('limit=0: 全部包裹', () => {
    const text = makeTable('Solo')
    const out = sanitizeTextForCard(text, 0)
    expect(out).toContain('```\n' + makeTable('Solo') + '\n```')
  })

  it('无表格原样返回', () => {
    expect(sanitizeTextForCard('no tables here')).toBe('no tables here')
  })

  it('FEISHU_CARD_TABLE_LIMIT 默认值 = 3', () => {
    expect(FEISHU_CARD_TABLE_LIMIT).toBe(3)
  })
})

describe('optimizeMarkdownForFeishu: 边界与真实场景', () => {
  it('screenshot 里的 OpenCutSkill 项目结构报告', () => {
    const input = `## OpenCutSkill 项目架构概览

### 1. 项目定位

Screen Studio 视频自动剪辑工具。

### 2. 模块结构

\`\`\`
opencutskill/
├── cli/
├── core/
└── tests/
\`\`\``
    const out = opt(input)
    expect(out).toContain('##### OpenCutSkill 项目架构概览')
    expect(out).toContain('##### 1. 项目定位')
    expect(out).toContain('##### 2. 模块结构')
    expect(out).toContain('opencutskill/')
    expect(out).toContain('├── cli/')
    expect(out).not.toMatch(/^## OpenCutSkill/m)
    expect(out).not.toMatch(/^### 1\./m)
    expect(out).toContain('<br>\n```')
    expect(out).toContain('```\n<br>')
  })

  it('异常输入 fallback 到原文不抛错', () => {
    expect(() => opt('\u0000\uFFFF```unclosed')).not.toThrow()
  })

  it('空字符串返回空字符串', () => {
    expect(opt('')).toBe('')
  })
})
