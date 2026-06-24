import React, { createContext, useContext, useState, useEffect } from 'react';
import { FeatureCard, ComparisonRow, SettingScreenshot, DocArticle, BenchmarkData } from '../types';

type Language = 'zh' | 'en';

interface LanguageContextProps {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, section?: string) => string;
  CORE_FEATURES: FeatureCard[];
  COMPARISON_TABLE: ComparisonRow[];
  SETTINGS_SHOWCASES: SettingScreenshot[];
  ARCHITECTURE_LAYERS: { title: string; tech: string; detail: string }[];
  BENCHMARKS: BenchmarkData[];
  DOC_ARTICLES: DocArticle[];
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

// Raw Bilingual Data structures
const ZH_CORE_FEATURES: FeatureCard[] = [
  {
    id: 'monitor',
    icon: 'Monitor',
    title: '本地运行',
    description: '告别浏览器插件。在桌面原生环境中与 AI 对话，会话状态自动持久化。'
  },
  {
    id: 'computeruse',
    icon: 'Bot',
    title: 'Computer Use',
    description: '接管屏幕与 UI 元素。两种模式：视觉截图或 UIA 树文本，后者更快且更省 token。'
  },
  {
    id: 'multiprovider',
    icon: 'Layers',
    title: '多模型路由',
    description: 'DeepSeek、通义、Kimi、MiniMax、Claude、GPT。切换提供商只需一次点击。'
  },
  {
    id: 'security',
    icon: 'Shield',
    title: '本地安全',
    description: '所有 API Key 存储在本地，不上传云端。危险操作逐条确认，拒绝静默执行。'
  },
  {
    id: 'mcp',
    icon: 'Wrench',
    title: 'MCP 扩展',
    description: 'Model Context Protocol 原生支持。可将任意工具封装为 MCP 服务器。'
  },
  {
    id: 'rustcore',
    icon: 'Cpu',
    title: 'Rust 核心',
    description: 'IPC 延迟小于 1ms。窗口状态、终端会话全程记忆，重启不丢失上下文。'
  }
];

const EN_CORE_FEATURES: FeatureCard[] = [
  {
    id: 'monitor',
    icon: 'Monitor',
    title: 'Local Standalone Running',
    description: 'Say goodbye to browser plugins. Chat with AI in a native desktop sandbox with auto-persisted sessions.'
  },
  {
    id: 'computeruse',
    icon: 'Bot',
    title: 'Computer Use',
    description: 'Take control of desktop screen and UIA elements. Offers both high-fidelity screenshots & lightning-fast UIA tree nodes.'
  },
  {
    id: 'multiprovider',
    icon: 'Layers',
    title: 'Multi-LLM Hot Swaps',
    description: 'Connect with DeepSeek, Qwen, Kimi, MiniMax, Claude, and GPT. Complete provider shifts with a single click.'
  },
  {
    id: 'security',
    icon: 'Shield',
    title: 'Absolute Privacy & Encryption',
    description: 'All API keys are held strictly in local keychain encryptions. Destructive operations require active prompts.'
  },
  {
    id: 'mcp',
    icon: 'Wrench',
    title: 'MCP Extensions Store',
    description: 'Native support for Model Context Protocols. Instantly bundle local commands and files into AI tool assets.'
  },
  {
    id: 'rustcore',
    icon: 'Cpu',
    title: 'Rust Core Shell',
    description: 'Sub-millisecond IPC communication logic. Complete process lifecycle tracker preserves terminal threads.'
  }
];

const ZH_COMPARISON_TABLE: ComparisonRow[] = [
  {
    criteria: '国内网络加速',
    cli: '必须稳定梯子，易连接超时',
    extension: '受外部网关限制，频繁报错',
    dreamcoder: '内置优秀代理层与本地镜像，直连免翻墙',
    isDreamCoderBetter: true
  },
  {
    criteria: '多模型及本地模型路由',
    cli: '需要繁琐地修改全局配置文件',
    extension: '多数只支持单一专属厂商',
    dreamcoder: '图形化一键热切换，集成国内主流 API 与 Ollama',
    isDreamCoderBetter: true
  },
  {
    criteria: '代码 Diff 与冲突审查',
    cli: '纯终端内输出 Patch 文本，阅读痛苦',
    extension: '只在局部编辑器显示，无法全局预览',
    dreamcoder: '侧边栏宽屏分栏对比，极佳视觉审查体验',
    isDreamCoderBetter: true
  },
  {
    criteria: '敏感指令与系统授权机制',
    cli: '终端全自动静默执行，安全隐患极大',
    extension: '调用权限模糊不清，容易出现误删误写',
    dreamcoder: '拦截所有系统写入與脚本执行，逐条确认放行',
    isDreamCoderBetter: true
  },
  {
    criteria: '工具链扩展 (MCP 支持)',
    cli: '需手动部署 NPM 组件，配置链路冗长',
    extension: '不支持自定义本地工具流协议',
    dreamcoder: '图形化管理 MCP 服务器，开箱即用生态市场',
    isDreamCoderBetter: true
  }
];

const EN_COMPARISON_TABLE: ComparisonRow[] = [
  {
    criteria: 'Network Optimization',
    cli: 'Requires highly stable proxies; prone to connection timeouts',
    extension: 'Limited by browser sandbox gateways; recurrent errors',
    dreamcoder: 'Built-in intelligent proxy mirror and caching layers; friction-free direct connection',
    isDreamCoderBetter: true
  },
  {
    criteria: 'Multi-Model Routing',
    cli: 'Demands tedious adjustments of global JSON files',
    extension: 'Most offer rigid support for a single model vendor',
    dreamcoder: 'Visual, one-click warm toggle supporting domestic APIs and local Ollama nodes',
    isDreamCoderBetter: true
  },
  {
    criteria: 'Code Differences & Review',
    cli: 'Prints patches raw inside CLI logs, hard to digest',
    extension: 'Restricted to IDE micro-split views; no overall dashboard',
    dreamcoder: 'Wide dual-column horizontal diff panels providing clear visualization audits',
    isDreamCoderBetter: true
  },
  {
    criteria: 'Privilege Authorizations',
    cli: 'Silent commands execute automatically, posing extreme risks',
    extension: 'Vague boundaries on local system files, prone to overwriting',
    dreamcoder: 'Active hook guards preventing unsanctioned scripts, prompts with active sliders',
    isDreamCoderBetter: true
  },
  {
    criteria: 'MCP Integrations',
    cli: 'Requires terminal NPM bootstrapping and verbose steps',
    extension: 'Drawn blanks for local custom tool protocols',
    dreamcoder: 'Graphical orchestration of MCP files, instant ecosystem adapters',
    isDreamCoderBetter: true
  }
];

const ZH_SETTINGS_SHOWCASES: SettingScreenshot[] = [
  {
    id: 'setting_provider',
    title: '多模型提供商后台',
    description: '支持 DreamField 官方通道、MIMO 通道、国内大模型直连等。一键完成 API Keys 配置，开启敏捷模型切换通道。',
    imagePath: '/dreamcoder/assets/setting_provider.png',
    badge: 'API 路由',
    tags: ['Provider', 'DeepSeek', 'MIMO', 'Claude']
  },
  {
    id: 'setting_computeruse',
    title: 'Computer Use 控制台',
    description: '提供 Vision（视觉截图识别）与 UIA Tree（无障碍节点文本解析）两种环境接管引擎。智能检测本地 Python 环境、虚拟沙盒及系统依赖。',
    imagePath: '/dreamcoder/assets/setting_computeruse.png',
    badge: '安全沙箱',
    tags: ['Tauri OS Control', 'Screen Grab', 'UIA Parser']
  },
  {
    id: 'setting_skills',
    title: 'MCP 技能工具中心',
    description: '一览已安装的丰富技能套件，详细评估技能深度、消耗模型 Token 以及预估开销。管理用户自定义开发的 Slash 快捷命令。',
    imagePath: '/dreamcoder/assets/setting_skills.png',
    badge: '工具生态',
    tags: ['Model Context Protocol', 'Custom Command', 'Plugins']
  }
];

const EN_SETTINGS_SHOWCASES: SettingScreenshot[] = [
  {
    id: 'setting_provider',
    title: 'Multi-LLM Provider Portal',
    description: 'Provides official DreamField gateway, MIMO adapters, and direct private keys setup. Bind tokens easily and initiate rapid hot switches.',
    imagePath: '/dreamcoder/assets/setting_provider.png',
    badge: 'LLM ROUTER',
    tags: ['Provider', 'DeepSeek', 'MIMO', 'Claude']
  },
  {
    id: 'setting_computeruse',
    title: 'Computer Use Console',
    description: 'Integrates premium screen capture or high-speed accessibility UIA Tree text scrapers. Checks native Python environments and dependencies auto-actively.',
    imagePath: '/dreamcoder/assets/setting_computeruse.png',
    badge: 'SANDBOX HOOK',
    tags: ['Tauri OS Control', 'Screen Grab', 'UIA Parser']
  },
  {
    id: 'setting_skills',
    title: 'MCP Tooling Hub',
    description: 'Displays installed plugins structure, measures capabilities depth and Token usages, and estimates operational costs. Guides custom shortcuts.',
    imagePath: '/dreamcoder/assets/setting_skills.png',
    badge: 'PLUGIN STORE',
    tags: ['Model Context Protocol', 'Custom Command', 'Plugins']
  }
];

const ZH_ARCHITECTURE_LAYERS = [
  {
    title: '1. UI 交互层 (Presentation)',
    tech: 'React 18 + Tailwind 4 + xterm.js',
    detail: '纯客户端渲染，采用经典“书页级”精简排版，轻盈典雅。内置高逼真端侧模拟命令行交互。'
  },
  {
    title: '2. 桌面级控制内核 (Tauri 2 + Rust)',
    tech: 'Tauri 2 API + Command Executors',
    detail: '多线程 Rust 驱动的核心进程。保障 IPC 进程通信延迟 < 1ms，极速读取无障碍 UIA Tree。'
  },
  {
    title: '3. 独立后台运行时 (Bun Engine)',
    tech: 'Bun Runtime Environment',
    detail: '相较 NodeJS 提升 4 倍启动速度，内置高效率项目分析与自动化脚本运行编译器。'
  },
  {
    title: '4. 分步式模型中转层 (Cloud Models / Local)',
    tech: 'DeepSeek / Kimi / Claude 3.5 / Ollama',
    detail: '无中间云端，API 直接请求提供商。支持本地大语言模型直连，端侧绝对隐私保密。'
  }
];

const EN_ARCHITECTURE_LAYERS = [
  {
    title: '1. Presentation UI Layer',
    tech: 'React 18 + Tailwind 4 + xterm.js',
    detail: 'Client-side SPA focused on high-density typographic layout. Features an ultra-realistic localized simulator terminal.'
  },
  {
    title: '2. Desktop Native Core',
    tech: 'Tauri 2 API + Rust Command Executors',
    detail: 'Multi-threaded safe Rust processes routing. Sustains sub-millisecond IPC roundtrips with native accessibility tree handles.'
  },
  {
    title: '3. Background Server Runtime',
    tech: 'Bun High-Performance Engine',
    detail: 'Loads up to 4x faster than standard NodeJS daemons. Orchestrates local workspace AST compilation & automated scripts compiles.'
  },
  {
    title: '4. Direct Provider Bridges',
    tech: 'DeepSeek / Kimi / Claude 3.5 / Ollama Local',
    detail: 'Directly channels API streams to LLM nodes. Eliminates mandatory centralized gateways, securing absolute code and key secrets.'
  }
];

const ZH_BENCHMARKS: BenchmarkData[] = [
  { metric: '应用启动时间 (Cold Boot)', dreamcoder: '180ms', competitor: '1150ms', improvement: '提升 84%', category: 'performance' },
  { metric: '进程间通信 (IPC) 延迟', dreamcoder: '0.85ms', competitor: '12.4ms', improvement: '缩短 93%', category: 'performance' },
  { metric: '内存静态消耗 (RAM Idle)', dreamcoder: '45MB', competitor: '280MB', improvement: '降低 83%', category: 'resource' },
  { metric: '无障碍 UIA Tree 解析速率', dreamcoder: '12ms / 万字节', competitor: '145ms / 万字节', improvement: '提升 91%', category: 'performance' },
  { metric: '单次截图扫描处理开销', dreamcoder: '节省 40% Token', competitor: '全量扫描', improvement: '节省 40%', category: 'resource' },
  { metric: '热重新加载 (HMR) 响应速度', dreamcoder: '42ms', competitor: '350ms', improvement: '快 8.3倍', category: 'performance' },
  { metric: '多任务会话切换延迟', dreamcoder: '3ms', competitor: '120ms', improvement: '提升 40倍', category: 'ux' },
  { metric: '敏感文件操作拦截准确率', dreamcoder: '100% 本地拦截', competitor: '无前置审核', improvement: '高保障', category: 'ux' },
  { metric: '本地密钥防泄露安全性', dreamcoder: '全沙盘强隔离', competitor: '明文存储', improvement: '极高级', category: 'ux' },
  { metric: '内置命令行输入时延', dreamcoder: '2ms (零延迟感)', competitor: '18ms (偶有卡顿)', improvement: '提升 88%', category: 'performance' },
  { metric: '工程检索向量索引载入率', dreamcoder: '4.2k 文件/秒', competitor: '0.8k 文件/秒', improvement: '提升 5.2倍', category: 'performance' },
  { metric: '本地日志记录器写消耗', dreamcoder: '接近零 CPU', competitor: '约 3% - 5% CPU', improvement: '极轻', category: 'resource' },
  { metric: 'MCP 设备挂载检测速度', dreamcoder: '实时 (热插拔)', competitor: '需重载配置文件', improvement: '极简', category: 'ux' },
  { metric: '版本升级安装包体积', dreamcoder: '8.4 MB (超轻量)', competitor: '120 MB + (Electron)', improvement: '缩小 93%', category: 'resource' }
];

const EN_BENCHMARKS: BenchmarkData[] = [
  { metric: 'Application Cold Boot', dreamcoder: '180ms', competitor: '1150ms', improvement: 'Uplift 84%', category: 'performance' },
  { metric: 'IPC Roundtrip Latency', dreamcoder: '0.85ms', competitor: '12.4ms', improvement: 'Slashed 93%', category: 'performance' },
  { metric: 'Idle Memory Footprint (RAM)', dreamcoder: '45MB', competitor: '280MB', improvement: 'Reduced 83%', category: 'resource' },
  { metric: 'Accessibility UIA Tree Scan Rate', dreamcoder: '12ms / 10KB', competitor: '145ms / 10KB', improvement: 'Uplift 91%', category: 'performance' },
  { metric: 'Single Screenshot Scan Token cost', dreamcoder: 'Saves 40% Token', competitor: 'Full pixel payload', improvement: 'Saved 40%', category: 'resource' },
  { metric: 'HMR Page Responsive Refresh', dreamcoder: '42ms', competitor: '350ms', improvement: '8.3x Faster', category: 'performance' },
  { metric: 'Multi-Task Session Switching delay', dreamcoder: '3ms', competitor: '120ms', improvement: '40x Faster', category: 'ux' },
  { metric: 'Host Level Malicious Script Intercept', dreamcoder: '100% Local Block', competitor: 'No guards check', improvement: 'Absolute Safety', category: 'ux' },
  { metric: 'Local Vault Keys Shield strength', dreamcoder: 'System Chain (Strict)', competitor: 'Raw local configs', improvement: 'Encrypted Vault', category: 'ux' },
  { metric: 'Built-in Shell Input latency', dreamcoder: '2ms (Fluid feel)', competitor: '18ms (Slight lag)', improvement: 'Improved 88%', category: 'performance' },
  { metric: 'Workspace Vector Files Indexing Sync', dreamcoder: '4.2k files/s', competitor: '0.8k files/s', improvement: '5.2x Faster', category: 'performance' },
  { metric: 'Local Logger CPU resources overhead', dreamcoder: 'Near-zero CPU', competitor: 'Around 3%-5% CPU', improvement: 'Friction-Free', category: 'resource' },
  { metric: 'New MCP Hot-Plug Scan Speed', dreamcoder: 'Plug-and-play', competitor: 'Hard config relink', improvement: 'Adaptive', category: 'ux' },
  { metric: 'Binary Package Bundle Size', dreamcoder: '8.4 MB (Tauri)', competitor: '120 MB + (Electron)', improvement: 'Slashed 93%', category: 'resource' }
];

const ZH_DOC_ARTICLES: DocArticle[] = [
  {
    id: 'quickstart',
    category: '上手指南',
    title: '快速开始 Quick Start',
    summary: '介绍 DreamCoder 的下载、本地极速安装，以及配置 API Keys 开始第一次会话的流程。',
    content: `# 快速开始 Quick Start

DreamCoder 是一款专门为桌面环境优化的 Claude Code 开源桌面客户端，提供直观、强大的可视化控制台。

### 1. 系统要求与安装

DreamCoder 极为轻量，安装包容量仅为 **8.4 MB**。因为它基于 Tauri 2 + Rust，共享操作系统原生的 Webview2 (Windows) 或 WebKit (macOS/Linux) 渲染引擎。

#### Windows
- 下载最新 \`*.msi\` 安装包并双击运行。
- 系统要求：Windows 10 / 11 64位。
- 可选：如果需要使用 Computer Use 自动化，请配置本地 Python 3。

#### macOS
- 下载 \`*.dmg\` 文件，将 **DreamCoder** 拖拽入 \`Applications\`。
- 系统要求：macOS 12 及更高版本 (支持 Apple Silicon 芯片 M1/M2/M3)。

---

### 2. 首要配置 (API Keys 路由)

打开 DreamCoder 客户端，点击左下角 **[设置]** 进入 **[服务商]** 面板：
1. **添加服务商**：点击右上角 \`+ 添加服务商\` 按钮。
2. **连接凭证输入**：输入您在对应模型平台申请 of API Key (例如 DeepSeek-API, Claude Anthropic 密钥，或者 Kimi 官方开放平台)。
3. **本地连接验证**：DreamCoder 采用绝对本地化，API Key 将直接存储在系统的敏感密钥加密环内，永远不会，也无法上传至任何中间云端数据库。

---

### 3. 创建您的第一个会话

1. 点击左上角 **[新建会话]**。
2. 在底部的输入框中输入：\`帮我分析当前工作目录下的工程结构，并创建一个 README.md 骨架\`。
3. 点击 **[运行]**。
4. 面板右侧会自动唤起集成式高逼真终端终端，采用精校的 \`JetBrains Mono\` 渲染命令行输出，并且逐行以极其优美的转译进度向您报告 AI 的任务分析。
5. 涉及到代码变更时，侧边栏会自动显示对比视图，点击绿色的 **[同意/确认]** 即可让 DreamCoder 写入您的代码。`
  },
  {
    id: 'computeruse',
    category: '核心特性',
    title: 'Computer Use 全面掌控',
    summary: '深入探究 DreamCoder 特有的两种系统接管模式：视觉截图扫描模式与极致性能 UIA Tree 解析模式。',
    content: `# Computer Use 自动化探索

DreamCoder 不仅提供常规的代码对话，更是全球首批深度整合 **Computer Use (电脑操控)** 能力的桌面集成工坊。

### 核心双模式原理

在设置界面的 **[Computer Use]** 栏目下，您可以使用以下两种策略让 AI 观察并驾驭视窗操作系统：

#### 1. 📂 视觉识别模式 (Vision Mode)
- **原理**：调用高级多模态视觉模型（如 Claude 3.5 Sonnet 或 GPT-4o），将屏幕实时抓取的无损 PNG 截图传给模型解码。
- **优点**：能够极佳地理解像素、排版、甚至图形绘制逻辑，可以跨应用识别设计误差、网页样式偏移。
- **缺点**：每次交互需要上传数十万像素数据，占用极高的网络传输频宽，高分辨率下相对耗费模型 API Token 额度。

#### 2. 🌲 元数据树节点模式 (UIA Tree Mode)
- **原理**：DreamCoder 独创。基于 Rust 核心高速轮询调用 Windows UI Automation 框架或 macOS Accessibility API，将桌面所有活跃软件的视觉组件树解析为纯结构化标记文本 (Structure Annotation Text)。
- **优点**：
  - **超强吞吐**：数据包转化为紧凑的 XML，相较图片方式**节省 40% 以上的 API Token** 算力资产。
  - **精确定位**：AI 直接获取组件的底层 \`ElementID\`，精准发送 \`Click\` 与 \`Type\` 系统指令，永远不会出现视觉错位双击导致的误触。
  - **极致敏捷**：免除图像上传和云端二次分析。

---

### 安全沙箱说明

为了完全保障您的用机安全，DreamCoder 在电脑受控期内设计了三重防护：
1. **严格的本地授权**：首次使用必须在 macOS \`系统偏好设置\` 赋予 \`辅助功能\` / \`屏幕录制\` 许可；Windows 平台将以隔离子进程吊装运行。
2. **人工操作锁**：任何关键的鼠标拖拽、长输入、以及软件安装等操作均存在前置阻断器，支持一键在顶部终止受控流。`
  },
  {
    id: 'mcp',
    category: '进阶拓展',
    title: 'Model Context Protocol (MCP) 精粹',
    summary: '如何管理、启用和调试本地及远程 MCP 工具服务，打通 AI 与本地数据管道。',
    content: `# MCP 生态扩展机制

**Model Context Protocol (MCP)** 是 Anthropic 推出的一款轻量级开放协议。旨在为模型创造标准、安全的工具外挂通道。DreamCoder 原生提供极佳的可视化管理界面。

### MCP 服务组装架构

\`\`\`
AI 思考 (大语言模型) 
       │ (通过 MCP 标准协议)
       ▼
DreamCoder 底层引擎 ───► 本地应用及各种数据源
       │ (执行具象工具)
       ├─► sqlite-viewer.exe
       ├─► read-local-docs (Python)
       └─► web-search-engine
\`\`\`

### 在 DreamCoder 内配置本地 MCP

1. 保证您的桌面环境安装了 \`Bun\` 或 \`NodeJS\`。
2. 点击 **[设置]** - **[MCP]**，可以看到当前已绑定的技能。
3. 点击 **[添加 MCP]**，输入自定义配置 JSON：
   \`\`\`json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Workspaces\\YourProject"]
       }
     }
   }
   \`\`\`
4. 点击“保存生效”。DreamCoder 的 Rust 主程序会作为主控制器，拉起该 MCP 进程进行持久化的标准 Stdio 通信。
5. AI 将会在下一次代码上下文对话中，主动感知 \`filesystem\` 下的 \`view_file\`、\`write_file\` 等扩展工具，并自由进行调用。`
  },
  {
    id: 'security',
    category: '产品安全',
    title: '本地隐私与系统安全',
    summary: '深入探究 DreamCoder 的核心安全法则：API 本地化保密技术、阻断层以及系统静默风险防范。',
    content: `# 隐私第一：DreamCoder 本地隐私守则

在 AI 开源浪潮下，您的软件资产与代码隐私极容易暴露。DreamCoder 坚信**“本地即圣殿”**。

### 1. 钥匙只配留在您手上

- **零数据外流**：DreamCoder **绝不设立中转云服务**。所有服务直连对应的提供商底层 API 节点，中间不经过任何第三方跳板服务器。
- **系统保护圈**：API Keys 在各操作系统上均经过专门处理：
  - Windows 平台调取内置的安全凭据管理器 \`Credential Manager\`。
  - macOS 平台使用硬件级的安全钥匙串 \`Keychain Services\` 对您的 Token 进行高强度混淆加密。
  - 彻底隔绝第三方窥伺木马直接读取明文 \`.env\` 文件的物理风险。

### 2. 行为级指令阻断体系

使用传统的 CLI 终端助理时，最头痛的莫过于 AI 悄无声息地写了一个 \`rm -rf\` 并在您发现前直接执行。

DreamCoder 对此设立了**极其坚固的物理前置确认拦截圈**：
- **可写的路径审查**：任何超出项目工作区 (WorkSpace Root) 的写入，均以红色警示高亮显示。
- **特权命令黑名单**：预置高风险的提权命令审查（如 \`sudo\`、全局格式化、关闭安全防火墙等），任何包含此类关键词的手稿都必须要人工进行两次“滑动放行才可触发”。
- **单步日志快照**：完整记录 AI 当前在终端所引发的句流追踪与进程生成，支持回融重来。`
  },
  {
    id: 'troubleshoot',
    category: '故障排除',
    title: '常见问题故障排除 FAQ',
    summary: '汇总了关于终端连通性、Python 虚拟沙盒环境不可用、国内大模型 API 路径报错等经典疑难解答。',
    content: `# 故障排除与调试手册

阅览此处的经典故障方案，帮您绕过桌面应用最易遇到的各种宿主机环境问题。

### 1. 为什么 Computer Use 报错“Python 解释器未检测到”？

**排查指引**：
- 请在系统中先确认安装了 \`Python 3.9\` ~ \`3.12\` 之间的任意版本，并勾选“Add python to PATH”。
- 在 DreamCoder **[设置] - [Computer Use]** 中，程序支持手动指定解释器物理路径（例如在 Windows 上，直接选中 Ananconda 下的 \`python.exe\` 或者 pyenv 中的特定垫片文件）。
- 点击“重新检测”即可通过握手评估。

---

### 2. 网络错误！提示：\`CONNECT_TIMEOUT\` 或是 \`Failed to fetch\`

**排查指引**：
- **代理设置不适用**：若是默认情况下，大模型走系统代理引发握手混乱。请点击 **[设置] - [通用]**，把网络连接选项从 \`System Proxy\` 切换为 \`No Proxy (直连国内供应商)\`。
- **DeepSeek 偶尔限流**：建议同时添加一至两个 MIMO 主动中转或者本地 Ollama 引擎（如本地拉起的 Llama 3），做为紧急降级的容灾线路，一键热替换，让生产活动永不间断。

---

### 3. MCP 服务在启动时异常闪退

**排查指引**：
- 打开 **[日志追踪]** 或打开开发开发者控制台（通过快捷键 \`Ctrl + Shift + I\` 或 \`Cmd + Option + I\`），检查外部宿主依赖包（如 Bun Runtime）是否可用。
- 请确保您运行 MCP 所需要的 NPM 库已经全局注入或者在对应配置参数的 \`env\` 段正确传递了路径环境变量。`
  },
  {
    id: 'devguide',
    category: '开发手册',
    title: '开发者指南 & 参与贡献',
    summary: '欢迎加入构建！学习如何基于 Rust (Tauri 2) 与 React 编译和测试 DreamCoder。',
    content: `# 社区开发者参与指南

作为一款由全国优秀开发者联手打造的 MIT 开源佳作，我们非常期待与您共同迭代 DreamCoder，并一同拓展其生态潜能。

### 1. 前置开发依赖
在开始本地编译拉起前，确保您的系统部署了：
- **Rustc & Cargo**：官方 Tauri 2 支持需要 Rust 稳定分支 (1.75 级更高版本)。
- **NodeJS / Bun**：建议选用最新的 \`Bun\` 做为极速包管理器。
- **Git**：拉取最新的主干分支。

### 2. 克隆与依赖拉取

\`\`\`bash
# 克隆仓库
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 安装依赖
bun install
\`\`\`

### 3. 开发阶段运行
\`\`\`bash
# 启动 Tauri 桌面级调试沙盒 (这会同时唤起 Web 编译服务器和 Rust 主机程序)
bun run tauri dev
\`\`\`

### 4. 交付生产包发布

如果您需要为特定平台编译优化的原生二进制执行包：
\`\`\`bash
bun run tauri build
\`\`\`
产物会自适应生成为 \`*.dmg\` (macOS) 以及 \`*.msi\` (Windows Desktop)。

### 单元和集成测试
- **前端页面单元校验**：建议通过 \`vitest\` 在隔离环境中进行。
- **Rust 通道安全性测试**：可在项目 \`src-tauri\` 下执行 \`cargo test\` 进行验证。`
  },
  {
    id: 'sessions',
    category: '产品安全',
    title: '会话管理与终端记忆',
    summary: '介绍 DreamCoder 高效的多会话侧边树管理、交互历史归档以及重启不丢失的会话机制。',
    content: `# 极速会话树与上下文机制

DreamCoder 与常规的单线程网页面向大模型的最大不同，就在于它是针对**长期工程级对话设计的持久桌面工作台**。

### 会话分级归纳

左侧边栏具备类似 IDE 的树状结构，您的每一次任务均作为一个“**专属于工程的 AI 会话上下文**”进行封存。

1. **新建会话**：一击立即进入无尘环境，可指向不同的微服务或子目录。
2. **会话过滤搜索**：通过内置拼音首字符和全局语义搜索，上个礼拜跟 AI 的探讨片段，零点几毫秒内即可在历史索引中唤醒。
3. **高保真终端联动**：
   - 每一个 Session 都包含一个完全平移绑定的 Shell 环境，窗口在后台会以微弱 CPU 驻留并记忆系统进程状态。
   - 当重启 DreamCoder 时，这些本地环境变量與工作树仍然会被精准锁定，让开发思绪真正回归流（Flow State）。
   - 告别云端工具切换时让人抓狂的重新部署和环境热预热。`
  }
];

const EN_DOC_ARTICLES: DocArticle[] = [
  {
    id: 'quickstart',
    category: 'Guide',
    title: 'Quick Start',
    summary: 'Learn how to download, install DreamCoder locally, and configure API Keys for your very first model session.',
    content: `# Quick Start Guide

DreamCoder is a lightweight, frontend-guided desktop shell for Claude Code. It offers immediate and fluid visualization controls.

### 1. Requirements & Native Engine

DreamCoder has an average package bundle size of just **8.4 MB**. Powered by Tauri 2 + Rust, it uses your operating system's native renderers (WebView2 on Windows; WebKit on macOS).

#### Windows Desktop
- Download the absolute latest \`*.msi\` setup and run.
- Prerequisites: Windows 10 / 11 64-bit.
- Optional: Local Python 3 environment if automation actions are required.

#### macOS Desktop
- Download the optimized \`*.dmg\` file, and drag **DreamCoder** into \`Applications\`.
- Prerequisites: macOS 12+ (Full support for Silicon Apple M1/M2/M3 chips).

---

### 2. Primary Configuration (API Keys Setup)

Launch DreamCoder, then click the **[Settings]** badge in the bottom-left corner and navigate to the **[Providers]** tab:
1. **Add Provider**: Click the \`+ Add Provider\` button in the top right.
2. **Credentials Input**: Fill in your private API Key (e.g. DeepSeek nodes, Anthropic Claude keys, or other aggregate gateways).
3. **Local Credentials Verification**: Your credentials are persisted inside your OS hardware secure ring (Keychain / Credential Manager) locally. Private keys are never uploaded to any remote clouds.

---

### 3. Initiate Your First Session

1. Click **[New Session]** on the left panel tree.
2. In the bottom command prompt bar, type: \`Analyze my system workspace files and format a clean README.md shell\`
3. Click **[Run]** or press \`Enter\`.
4. The integrated visual terminal on the right wakes up. Rendered with custom \`JetBrains Mono\`, it displays the compilation logs and steps itemized by AI.
5. If file changes occur, a clean visual diff drawer triggers immediately. Review and click **[Accept/Confirm]** to authorize.'`
  },
  {
    id: 'computeruse',
    category: 'Features',
    title: 'Computer Use Automation',
    summary: 'Inspect how DreamCoder drives system actions under the dual visual screenshot model or the structured UIA Tree model.',
    content: `# Computer Use Automations

DreamCoder is among the world's first GUI wrappers to natively integrate **Computer Use** controls directly onto a sleek client panel.

### Understanding the Dual Scraper Engine

In **[Settings] - [Computer Use]**, you can choose between two visual tracking strategies for system orchestration:

#### 1. 📂 Vision Scraper Mode
- **Theory**: Takes zero-loss PNG screenshots of client screens, passing them to vision endpoints (e.g., Claude 3.5 Sonnet / GPT-4o).
- **Pros**: Perfectly interprets responsive styles, spatial distances, typography, and overlapping windows.
- **Cons**: Uploads high-res images on every cycle, incurring larger bandwidth latency and spending higher API token quotas.

#### 2. 🌲 Structural UIA Tree Mode
- **Theory (Custom Rust Toolchain)**: Queries native Windows UI Automation or macOS Accessibility APIs rapidly, producing compact structure annotations.
- **Pros**:
  - **Ultra-High Throughput**: Converts screen hierarchy into small text payloads, **saving more than 40% of Token expenses**.
  - **Failsafe Double-clicks**: AI uses deep OS element IDs like \`ElementID\` to fire click events with 100% geometric accuracy.
  - **Zero Frame Overhead**: Skips heavy image transcoding layers.

---

### Strict Sandbox Protocol

To secure user endpoints, DreamCoder deploys three physical safety measures:
1. **Manual System Permission**: Explicit OS accessibility and window capture permissions are mandatory.
2. **User Overrides Hook**: All active keystrokes and pointer coordinates can be frozen immediately using top control bars.`
  },
  {
    id: 'mcp',
    category: 'Extensions',
    title: 'Model Context Protocol (MCP) Integration',
    summary: 'Configure, manage, and debug local or absolute remote MCP servers, extending models into file environments.',
    content: `# MCP Protocols Core

**Model Context Protocol (MCP)** by Anthropic is an elegant protocol designed to integrate standard APIs and tools directly with AI agents. DreamCoder integrates a rich, unified visual dashboard for it.

### Architecture Schema

\`\`\`
AI Cogitations (Cloud Weights)
       │ (Standardized MCP Payload)
       ▼
DreamCoder Core Engine ───► Host Directories & Data Repos
       │ (Executes tool actions)
       ├─► sqlite-viewer.exe
       ├─► read-local-docs (Python)
       └─► web-search-engine
\`\`\`

### Configuring MCP in DreamCoder

1. Ensure your host has \`Bun\` or \`NodeJS\` installed.
2. Click **[Settings]** - **[MCP]** to view active pipelines.
3. Click **[Add MCP Server]**, pasting standard JSON configurations:
   \`\`\`json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Workspaces\\YourProject"]
       }
     }
   }
   \`\`\`
4. Save to reload. The Tauri Rust host acts as a persistent stdio executor, holding life threads for child sub-processes.
5. The AI agent immediately queries and utilizes filesystem tools in subsequent prompts.`
  },
  {
    id: 'security',
    category: 'Safety',
    title: 'Local Privacy & System Isolation',
    summary: 'Explore our local security blueprint: keychain lockboxes, command interceptors, and strict audits.',
    content: `# Local Integrity & Code Security

In an era of hyper-connected LLMs, code and API keys are highly vulnerable. DreamCoder operates with a **Local-First Sanctum** strategy.

### 1. Hardware-Keys Vaults
- **Zero Centralized Siphoning**: DreamCoder **maintains no proxy clouds**. Raw payloads stream straight to endpoint servers.
- **Safe Keychain Binding**:
  - Windows leverages the cryptographically sound \`Credential Manager\`.
  - macOS maps keys directly onto Apple's hardware-backed \`Keychain Services\`.
  - Immunizes keys against common malware targeting plain \`.env\` text files.

### 2. Granular Script Interceptors

Unlike standard CLIs that might run a destructive script silently, DreamCoder erects physical confirmation walls:
- **Workspace Bounds Audit**: Any write directives navigating outside the root namespace trigger intense red UI warnings.
- **Privilege Blocklists**: Commands containing high-privilege keywords (e.g. \`sudo\`, global format calls) require user slider validation.
- **Live State Snapshots**: Records every shell execution thread, allowing users to backtrack safely.`
  },
  {
    id: 'troubleshoot',
    category: 'FAQ',
    title: 'Troubleshooting & FAQ',
    summary: 'Overcome common hurdles, from proxy handshake errors to unresolved Python virtual environments.',
    content: `# Technical Diagnostics Guide

Leverage these battle-tested debug procedures to conquer common system hurdles.

### 1. "Python Interpreter Not Found" on Computer Use
- **Action Step**: Confirm your system has \`Python 3.9\` through \`3.12\` installed, with the "Add python to PATH" checklist ticked.
- Navigate to **[Settings] - [Computer Use]** to manually specify bin paths (e.g., target specific pyenv or conda virtual path setups).
- Execute "Run Diagnostics" to pass environment Handshakes.

---

### 2. Network Timeouts: \`CONNECT_TIMEOUT\` / \`Failed to fetch\`
- **Action Step**: If standard proxies mangle API streams, open **[Settings] - [General]**, and change network configurations from \`System Proxy\` to \`No Proxy (Direct Node Stream)\`.
- Always import backup models (e.g., local llama models via Ollama) to keep projects fluid even during central service bottlenecks.

---

### 3. MCP Subprocess Crashes on Load
- **Action Step**: Open Chrome DevTools inside Tauri via \`Ctrl + Shift + I\`. Verify if essential runtimes are available in standard environment variables.
- Match argument syntax structures inside your MCP JSON files exactly.`
  },
  {
    id: 'devguide',
    category: 'Developer',
    title: 'Developer Guideline',
    summary: 'Join our collaborative open-source community! Compile, build, and audit DreamCoder using Rust & React.',
    content: `# Community Developer Manual

As an open-source tool built on core MIT licenses, we welcome developers worldwide to help build this beautiful desktop sanctuary.

### 1. Local Requirements
Ensure your workspace includes:
- **Rustc & Cargo**: Tauri 2 requires stable Rust packages (1.75+).
- **Bun Package Manager**: Preferred for faster runtime installations.
- **Git**: Clone the official repository.

### 2. Clone & Bootstrap
\`\`\`bash
# Clone Repository
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# Bootstrap dependencies
bun install
\`\`\`

### 3. Running Dev Mode
\`\`\`bash
# Launch Tauri Desktop sandbox with integrated live-reload dev server handles
bun run tauri dev
\`\`\`

### 4. Compiling Production Builds
\`\`\`bash
bun run tauri build
\`\`\`
Standalone \`*.dmg\` and \`*.msi\` formats compile and compress in \`src-tauri/target/release/\`.`
  },
  {
    id: 'sessions',
    category: 'Safety',
    title: 'Session Persistencies',
    summary: 'Understand DreamCoder\'s persistent session management, side-trees, and terminal context memory systems.',
    content: `# Contextual Workspaces Memory

DreamCoder is built specifically to serve as a **long-term desktop companion workspace** for complex developer tasks.

### Structured Work Areas

The sidebar lists workspace sessions in an elegant directory trees structure, preserving context separate from unrelated projects.

1. **Brand-New Sessions**: Start off with a completely clean context pointing to different microservice directories.
2. **Instant fuzzy search**: Search through past session transcripts swiftly using metadata identifiers.
3. **High-Fidelity CLI hooks**:
   - Each session holds an active shell thread in background states with a low CPU foot-print.
   - When restarting the app, variables and work states remain intact, locking developers back into their optimal flow.
   - Saves hours spent on re-booting setups or re-loading configurations.`
  }
];

// Mapping UI Translation tokens
const UI_TRANSLATIONS: Record<Language, Record<string, string>> = {
  zh: {
    // Navigation
    'nav.home': '首页 Landing',
    'nav.docs': '技术手册 Docs',
    'nav.spec': '规范 Playground',
    'nav.github': 'GitHub Star',
    'brand.badge': 'v0.3.0',
    'brand.subtitle': 'Claude Code 开源桌面化 GUI 杰作',
    
    // Hero
    'hero.title': 'The Claude Code Desktop Sanctuary',
    'hero.desc': 'Claude Code 非常强大，但由于纯命令行模式阻隔，很多普通或国内开发者难以极速驾驭其高维能力。DreamCoder 把最卓越的本地 AI 编码内核装配进了优雅、轻量级的精美桌面系统面板，原生无须翻墙即可一键调用国内、国际主流大模型。',
    'hero.btn.win': '下载 Windows 稳定包 (.msi)',
    'hero.btn.mac': '下载 macOS M1/M2/M3 (.dmg)',
    'hero.btn.docs': '阅读离线文档',
    'hero.metrics.ipc': 'IPC 进程通信时延',
    'hero.metrics.models': '主流模型热切换',
    'hero.metrics.security': '数据安全上传',
    'hero.sim.title': '交互式客户端主界面全逼真预览',
    'hero.dl.sim': '正在模拟下载 DreamCoder {os} 原生包...',
    'hero.dl.tip': '正在极速拉取端侧 Rust 主机骨壳 (体积仅 8.4MB)。相较于 Electron 等臃肿框架 (平均 150MB)，Tauri 桌面能耗极低，启动飞快。',
    'hero.dl.success': 'DreamCoder 原生桌面安装包 (*.{ext}) 下载预备完成！大小仅 8.4MB，开箱即用。',

    // Comparative Analysis
    'cmp.badge': 'ARCHITECTURAL SELECTION COMPARISON',
    'cmp.title': '为什么挑选 DreamCoder',
    'cmp.subtitle': '技术选型评估：终端 CLI 命令行 vs 浏览器插件 vs 暖色桌面工坊',
    'cmp.col.criteria': '对比维度 (Criteria)',
    'cmp.col.cli': '纯 CLI 命令行 (Claude Code)',
    'cmp.col.ext': '普通浏览器 AI 插件',
    'cmp.col.dc': 'DreamCoder 开源图形桌面',

    // Six features
    'feat.badge': 'CORE SEED FEATURES OVERVIEW',
    'feat.title': '六大核心自主技术',
    'feat.subtitle': '轻型底层开发，打破单一约束，拓展本地全链',
    'feat.card.view': '调取沙盒模拟器查看...',

    // Screen dashboards
    'dash.badge': 'GRAPHICAL SCREEN CHANNELS',
    'dash.title': '设置及控制中台大图示',
    'dash.subtitle': '设计解决机制 #2 & #3：截图采用高透视觉组件与模拟器无缝绑定，点击右侧直接切换沙箱调试。',
    'dash.btn.switch': '切换进入此版面沙盒交互',
    'dash.btn.sim': '点此全真模拟',
    'dash.tag.mapped': 'Screenshot Mapped:',

    // Architecture
    'arch.badge': 'SYSTEM ARCHITECTURE MAP',
    'arch.title': '数据流与技术拓扑架构',
    'arch.subtitle': '本地直连模型，免去复杂的云端数据路由',
    'arch.label.ui': '1. UI 交互层',
    'arch.label.ui.desc': 'React 18 + xterm.js',
    'arch.label.tauri': '2. Tauri 2 (Rust)',
    'arch.label.tauri.desc': 'IPC 守护 ‹ 1ms 时延',
    'arch.label.runtime': '3. Bun 运行时',
    'arch.label.runtime.desc': 'AST 高效分析套件',
    'arch.label.model': '4. 分布式模型层',
    'arch.label.model.desc': 'DeepSeek / Claude',

    // Benchmarks
    'bench.badge': 'STRICT OPTIMIZATION BENCHMARKS',
    'bench.title': '性能深度优化测试 (14点对比)',
    'bench.subtitle': '我们极致挖掘 Tauri 2 原生架构潜能，与Electron笨重传统做严肃切磋',
    'bench.cat.all': '全部 14 项',
    'bench.cat.perf': '计算性能',
    'bench.cat.res': '资源消耗',
    'bench.cat.ux': '用户感知',
    'bench.label.uplift': '对比提升效益',
    'bench.label.avg': '竞品平均',

    // Footer CTA
    'cta.title': '准备好升级您的 AI 编程体验了吗？',
    'cta.desc': 'DreamCoder 是遵循古朴技术精神和 MIT 开源分段授权协议而作。无论是个人学习体验，还是大型公司企业，皆可完全免费持久用下去。',
    'cta.btn.dl': '立即下载 client (.msi)',
    'cta.btn.star': 'Star on GitHub',

    // Global Footer
    'footer.about.title': '关于 DreamCoder',
    'footer.about.desc': '面向国内敏捷开发群体的 Claude Code 桌面 GUI 主控工坊，遵循 MIT 开源和用户数据完全本地驻留理念。',
    'footer.manual.title': '产品分册',
    'footer.manual.qs': '极速快速开始',
    'footer.manual.cu': 'Computer Use 接管指南',
    'footer.manual.mcp': 'MCP 标准外设挂载',
    'footer.collab.title': '开发合作',
    'footer.collab.repo': 'GitHub 贡献仓库',
    'footer.collab.bugs': '汇报 BUG / Issue',
    'footer.collab.spec': 'UI 交互设计规范',
    'footer.security.title': '安全特权说明',
    'footer.security.desc': '极速端侧绝对安全：本客户端不架设云服务器进行中转。所有的 API Keys 和本地工程，物理隔离保存在您本机的敏感硬件钥匙链。',
    'footer.copyright': '© 2026 DreamCoder Open Source Group. Open Source licensed under the MIT License.',

    // Simulator specific UI labels (will override local keys)
    'sim.sidebar.workspace': '工程空间',
    'sim.sidebar.newsess': '新建会话',
    'sim.sidebar.settings': '工坊设置',
    'sim.sidebar.search': '检索会话名称...',
    'sim.sidebar.locked': '已锁定项目 [ PAI_dev ] 上下文',
    'sim.header.status': '端侧守护中',
    'sim.header.sandbox': '沙箱运行中',
    'sim.tab.title': '主干开发',
    'sim.tab.computer': 'OS 接管',
    'sim.tab.providers': '大模型配配',
    'sim.tab.skills': 'MCP 扩展',
    'sim.chat.thought': 'AI 思索痕迹',
    'sim.chat.tool': '底层工具调用',
    'sim.chat.auth': '等待人工批准授权',
    'sim.chat.accept': '滑动放行执行 (Slide to Accept)',
    'sim.chat.deny': '拒绝执行',
    'sim.input.placeholder': '输入您的系统开发指令...（按回车执行或开始极速仿真）'
  },
  
  en: {
    // Navigation
    'nav.home': 'Landing / Home',
    'nav.docs': 'Developer Docs',
    'nav.spec': 'Layout Playground',
    'nav.github': 'GitHub Star',
    'brand.badge': 'v0.3.0',
    'brand.subtitle': 'Claude Code Open-Source Desktop GUI Sanctuary',
    
    // Hero
    'hero.title': 'The Claude Code Desktop Sanctuary',
    'hero.desc': 'Claude Code is extremely powerful, but its steep command-line barrier blocks many developers. DreamCoder installs the most exceptional local AI developer cores into an elegant, lightweight desktop client interface with native optimized proxy mirrors & zero sandbox file transfers.',
    'hero.btn.win': 'Download Windows Stable (.msi)',
    'hero.btn.mac': 'Download macOS M1/M2/M3 (.dmg)',
    'hero.btn.docs': 'Read Documentation Offline',
    'hero.metrics.ipc': 'IPC Core roundtrips',
    'hero.metrics.models': 'Provider Hot-Swapping',
    'hero.metrics.security': 'Cloud Zero-Egress Secrets',
    'hero.sim.title': 'Interactive desktop client workstation real-time simulation',
    'hero.dl.sim': 'Downloading DreamCoder {os} system bundle...',
    'hero.dl.tip': 'Downloading Rust host core binary (size is merely 8.4MB). Comparing with bloated electron runtimes (about 150MB+), our Tauri framework ensures zero core CPU usage.',
    'hero.dl.success': 'DreamCoder native desktop bundle (*.{ext}) download prepared successfully! Size: 8.4MB. Instant setup.',

    // Comparative Analysis
    'cmp.badge': 'ARCHITECTURAL SELECTION COMPARISON',
    'cmp.title': 'Why Choose DreamCoder?',
    'cmp.subtitle': 'Architectural Evaluation: Standard Terminal CLI vs Browser AI Plugins vs Warm Tauri Workspaces',
    'cmp.col.criteria': 'Criteria Dimensions',
    'cmp.col.cli': 'Terminal CLI (Claude Code)',
    'cmp.col.ext': 'Standard Browser Extensions',
    'cmp.col.dc': 'DreamCoder Desktop Client',

    // Six features
    'feat.badge': 'CORE SEED FEATURES OVERVIEW',
    'feat.title': 'Six Tailored Architectural Pillars',
    'feat.subtitle': 'Low-level sandboxing, breaks terminal boundaries, guarantees 100% key separation',
    'feat.card.view': 'View in active sandbox...',

    // Screen dashboards
    'dash.badge': 'GRAPHICAL SCREEN CHANNELS',
    'dash.title': 'Integrated Control Center & Dashboards',
    'dash.subtitle': 'Elegant dashboard screens connected dynamically to our sandbox. Click widgets on the right to navigate screens.',
    'dash.btn.switch': 'Jump into Interactive Simulator Tab',
    'dash.btn.sim': 'Play on Simulator Sandbox',
    'dash.tag.mapped': 'Screenshot Mapped:',

    // Architecture
    'arch.badge': 'SYSTEM ARCHITECTURE MAP',
    'arch.title': 'Data Streams & Component Architectures',
    'arch.subtitle': 'Enforces immediate point-to-point connections, skipping centralized relay systems',
    'arch.label.ui': '1. Presentation Layer',
    'arch.label.ui.desc': 'React 18 + xterm.js SPA',
    'arch.label.tauri': '2. Tauri 2 (Rust)',
    'arch.label.tauri.desc': 'Multi-threaded IPC Shell',
    'arch.label.runtime': '3. Bun Environment',
    'arch.label.runtime.desc': 'Sub-second AST Compiler',
    'arch.label.model': '4. Distributed LLMs',
    'arch.label.model.desc': 'DeepSeek / Anthropic / Ollama',

    // Benchmarks
    'bench.badge': 'STRICT OPTIMIZATION BENCHMARKS',
    'bench.title': 'Performance & Optimization Benchmarks (14 Items)',
    'bench.subtitle': 'We optimize Tauri 2 to its limit, challenging heavyweight standard electron frameworks',
    'bench.cat.all': 'All 14 Benchmarks',
    'bench.cat.perf': 'Compute Performance',
    'bench.cat.res': 'Resource footprint',
    'bench.cat.ux': 'User Perception',
    'bench.label.uplift': 'Performance Uplift Benefit',
    'bench.label.avg': 'Competitor average',

    // Footer CTA
    'cta.title': 'Ready to upgrade your AI coding workspace?',
    'cta.desc': 'DreamCoder is built under open-source MIT guidelines. It is 100% free of charge for individual developers and large-scale enterprise environments permanently.',
    'cta.btn.dl': 'Download client now (.msi)',
    'cta.btn.star': 'Star on GitHub Repository',

    // Global Footer
    'footer.about.title': 'About DreamCoder',
    'footer.about.desc': 'A Tailored desktop graphical sanctuary for Claude Code, built on MIT open-source models with absolute local storage guarantees.',
    'footer.manual.title': 'Manual chapters',
    'footer.manual.qs': 'Rapid Quick Start',
    'footer.manual.cu': 'Computer Use Integration',
    'footer.manual.mcp': 'MCP Plugins standard setups',
    'footer.collab.title': 'Collaborations',
    'footer.collab.repo': 'GitHub Repository',
    'footer.collab.bugs': 'Submit Bug Issues',
    'footer.collab.spec': 'Interactive Design Specs',
    'footer.security.title': 'Security & Protection',
    'footer.security.desc': 'Instant secure isolation: This client does not boot any remote databases for credentials routing. All private API Keys are locked inside your OS hardware Keychain.',
    'footer.copyright': '© 2026 DreamCoder Open Source Group. Open Source licensed under the MIT License.',

    // Simulator specific UI labels
    'sim.sidebar.workspace': 'Workspace Sessions',
    'sim.sidebar.newsess': 'New Session',
    'sim.sidebar.settings': 'Settings Hub',
    'sim.sidebar.search': 'Fuzzy search sessions name...',
    'sim.sidebar.locked': 'Locked Workspace [ PAI_dev ] root',
    'sim.header.status': 'Local Core Safeguarding',
    'sim.header.sandbox': 'Sandbox Active',
    'sim.tab.title': 'Main Branch chat',
    'sim.tab.computer': 'Computer Use',
    'sim.tab.providers': 'Models & Providers',
    'sim.tab.skills': 'MCP Protocol',
    'sim.chat.thought': 'AI Reasoning Flow',
    'sim.chat.tool': 'Native Tool Trigger',
    'sim.chat.auth': 'Awaiting Manual Security Approval',
    'sim.chat.accept': 'Slide to Accept Command execution',
    'sim.chat.deny': 'Reject execution',
    'sim.input.placeholder': 'Enter workspace development prompts... (Press Enter or trigger simulation)'
  }
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('dreamcoder_lang');
      return (saved === 'en' || saved === 'zh') ? saved : 'zh';
    } catch {
      return 'zh';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('dreamcoder_lang', lang);
      document.documentElement.lang = lang;
    } catch (e) {
      console.warn('LocalStorage not available', e);
    }
  }, [lang]);

  const t = (key: string, section?: string): string => {
    const defaultDict = UI_TRANSLATIONS[lang];
    if (defaultDict && defaultDict[key]) {
      return defaultDict[key];
    }
    return key;
  };

  const currentFeatures = lang === 'zh' ? ZH_CORE_FEATURES : EN_CORE_FEATURES;
  const currentComparison = lang === 'zh' ? ZH_COMPARISON_TABLE : EN_COMPARISON_TABLE;
  const currentSettings = lang === 'zh' ? ZH_SETTINGS_SHOWCASES : EN_SETTINGS_SHOWCASES;
  const currentArchitecture = lang === 'zh' ? ZH_ARCHITECTURE_LAYERS : EN_ARCHITECTURE_LAYERS;
  const currentBenchmarks = lang === 'zh' ? ZH_BENCHMARKS : EN_BENCHMARKS;
  const currentDocs = lang === 'zh' ? ZH_DOC_ARTICLES : EN_DOC_ARTICLES;

  return (
    <LanguageContext.Provider value={{
      lang,
      setLang,
      t,
      CORE_FEATURES: currentFeatures,
      COMPARISON_TABLE: currentComparison,
      SETTINGS_SHOWCASES: currentSettings,
      ARCHITECTURE_LAYERS: currentArchitecture,
      BENCHMARKS: currentBenchmarks,
      DOC_ARTICLES: currentDocs,
    }}>
      {children}
    </LanguageContext.Provider>
  );
};
