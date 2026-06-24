import { FeatureCard, ComparisonRow, SettingScreenshot, DocArticle, BenchmarkData } from './types';

export const CORE_FEATURES: FeatureCard[] = [
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

export const COMPARISON_TABLE: ComparisonRow[] = [
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

export const SETTINGS_SHOWCASES: SettingScreenshot[] = [
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

export const ARCHITECTURE_LAYERS = [
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
    title: '4. 分布式模型中转层 (Cloud Models / Local)',
    tech: 'DeepSeek / Kimi / Claude 3.5 / Ollama',
    detail: '无中间云端，API 直接请求提供商。支持本地大语言模型直连，端侧绝对隐私保密。'
  }
];

export const BENCHMARKS: BenchmarkData[] = [
  { metric: '应用启动时间 (Cold Boot)', dreamcoder: '250ms', competitor: '1150ms', improvement: '提升 78%', category: 'performance' },
  { metric: '进程间通信 (IPC) 延迟', dreamcoder: '0.85ms', competitor: '12.4ms', improvement: '缩短 93%', category: 'performance' },
  { metric: '内存静态消耗 (RAM Idle)', dreamcoder: '45MB', competitor: '280MB', improvement: '降低 83%', category: 'resource' },
  { metric: '无障碍 UIA Tree 解析速率', dreamcoder: '12ms / 万字节', competitor: '145ms / 万字节', improvement: '提升 91%', category: 'performance' },
  { metric: '单次截图扫描处理开销', dreamcoder: '节省 40% Token', competitor: '全量扫描', improvement: '节省 40%', category: 'resource' },
  { metric: '热重新加载 (HMR) 响应速度', dreamcoder: '42ms', competitor: '350ms', improvement: '快 8.3倍', category: 'performance' },
  { metric: '多任务会话切换延迟', dreamcoder: '5ms', competitor: '120ms', improvement: '提升 24倍', category: 'ux' },
  { metric: '敏感文件操作拦截机制', dreamcoder: '前置拦截 + 逐条确认', competitor: '无前置审核', improvement: '主动防护', category: 'ux' },
  { metric: '本地密钥存储安全', dreamcoder: 'OS Keychain 加密存储', competitor: '配置文件存储', improvement: '硬件级加密', category: 'ux' },
  { metric: '内置命令行输入时延', dreamcoder: '3ms', competitor: '18ms', improvement: '提升 83%', category: 'performance' },
  { metric: '工程检索向量索引载入率', dreamcoder: '4.2k 文件/秒', competitor: '0.8k 文件/秒', improvement: '提升 5.2倍', category: 'performance' },
  { metric: '本地日志记录器写消耗', dreamcoder: '< 0.1% CPU', competitor: '约 3% - 5% CPU', improvement: '极低', category: 'resource' },
  { metric: 'MCP 设备挂载检测速度', dreamcoder: '实时 (热插拔)', competitor: '需重载配置文件', improvement: '极简', category: 'ux' },
  { metric: '版本升级安装包体积', dreamcoder: '8.4 MB (超轻量)', competitor: '120 MB + (Electron)', improvement: '缩小 93%', category: 'resource' }
];

export const DOC_ARTICLES: DocArticle[] = [
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
2. **连接凭证输入**：输入您在对应模型平台申请的 API Key (例如 DeepSeek-API, Claude Anthropic 密钥，或者 Kimi 官方开放平台)。
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
- **单步日志快照**：完整记录 AI 当前在终端所引发的句流追踪与进程生成，支持回滚重来。`
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
