import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, Shield, Cpu, Layers, Wrench, Monitor, Search, Plus, Trash2, 
  RefreshCw, Settings, Folder, Check, AlertTriangle, ChevronRight, 
  Sliders, Github, ExternalLink, Play, Terminal, ChevronDown, Copy, 
  HelpCircle, Sparkles, Code2, Globe, Minimize2, ZoomIn, Info, Eye,
  Lock, User, Sparkle, Download, ShieldCheck, Zap, Clock, Info as InfoIcon,
  ChevronUp, Server, HardDrive, Network, FileCode, CheckCircle2, ListFilter,
  Calendar, Flame, LayoutList, PackageOpen, HelpCircle as HelpIcon, ArrowUpRight,
  Activity
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface AppShowcaseProps {
  initialTab?: string;
}

// Preset themes that dynamically update the simulated Tauri client skin!
type SimTheme = 'warm' | 'light' | 'dark' | 'midnight' | 'emerald' | 'amber';

// Bilingual Initializer Helpers
const getInitialSessionMessages = (lang: 'zh' | 'en'): Record<string, any[]> => ({
  PAI_dev: [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh' 
        ? '我把文档都放到了 E:\\AProject\\TianX\\Personal\\PAI_dev\\docs\\requirements 告诉你一声'
        : 'Just wanted to let you know I put all the documents in E:\\AProject\\TianX\\Personal\\PAI_dev\\docs\\requirements'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '用户把文档移动到了 docs/requirements 目录。让我确认一下。'
        : 'The user moved the documents to the docs/requirements directory. Let me check and confirm.'
    },
    {
      id: 3,
      sender: 'assistant',
      text: lang === 'zh'
        ? '好的，让我确认一下文档位置。'
        : 'Sure, let me confirm the file path for these documents.',
      actionButtons: true
    },
    {
      id: 4,
      sender: 'tool',
      commandType: 'bash',
      commandCode: 'ls -la "E:/AProject/TianX/Personal/PAI_dev/docs/requirements/"',
      commandStdout: 'total 12\ndrwxr-xr-x 1 tianx user 4096 Jun 07 14:40 .\ndrwxr-xr-x 1 tianx user 4096 Jun 07 14:40 ..\n-rw-r--r-- 1 tianx user 2314 Jun 07 14:40 PAI-UI-Design-Requirements.md\n-rw-r--r-- 1 tianx user 1892 Jun 07 14:40 PAI-Chat-Interface-Requirements.md\n-rw-r--r-- 1 tianx user 1540 Jun 07 14:40 PAI-Friendship-Interaction-Requirements.md',
      isOpen: false
    },
    {
      id: 5,
      sender: 'thought',
      text: lang === 'zh'
        ? '用户把文档移动到了 docs/requirements 目录。我们需要更新一下文档，把原来的旧文档删除，保持一致。'
        : 'The user moved the documents to docs/requirements. We need to clean up and remove the old legacy files to maintain workspace consistency.'
    },
    {
      id: 6,
      sender: 'tool',
      commandType: 'bash',
      commandCode: 'cd "E:/AProject/TianX/Personal/PAI_dev" && rm docs/PAI-*.md 2>/dev/null; git status',
      commandStdout: 'On branch master\nYour branch is up to date with \'origin/master\'.\n\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n\tdeleted:    docs/PAI-UI-Legacy-02.md\n\tdeleted:    docs/PAI-Chat-Legacy-02.md\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tdocs/requirements/\n\nno changes added to commit (use "git add" and/or "git commit -a")',
      isOpen: false
    },
    {
      id: 7,
      sender: 'thought',
      text: lang === 'zh'
        ? '用户告诉我我已经把文档放到了 docs/requirements 目录。我已经清理了旧文档并看到了新目录的内容。'
        : 'The user notified me about the docs/requirements folder. I cleaned up the legacy docs and now see the updated files.'
    },
    {
      id: 8,
      sender: 'assistant',
      text: lang === 'zh'
        ? '看到了，文档已整理到 docs/requirements/ 目录：'
        : 'Got it! I see the documents have been organized under docs/requirements/:',
      filesList: [
        { 
          name: 'PAI-UI-Design-Requirements.md', 
          desc: lang === 'zh' ? '整体 UI 设计' : 'Overall UI Design Specs' 
        },
        { 
          name: 'PAI-Chat-Interface-Requirements.md', 
          desc: lang === 'zh' ? 'Chat 界面与状态规范' : 'Chat View state guidelines' 
        },
        { 
          name: 'PAI-Friendship-Interaction-Requirements.md', 
          desc: lang === 'zh' ? '好友端侧互动组件' : 'Friendship Interaction widgets' 
        }
      ]
    }
  ],
  dreamfield: [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '帮我检查当前绑定的 DreamField 官方服务商状态和 API 密钥'
        : 'Help me verify the status and API keys of the currently mapped DreamField provider.'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '正在检查已配置的服务商列表，拉取默认官方模型 GLM-5.1 的端点设置。'
        : 'Checking initialized providers list, fetching endpoint configuration for the official GLM-5.1 route.'
    },
    {
      id: 3,
      sender: 'tool',
      commandType: 'bash',
      commandCode: 'curl -s -o /dev/null -w "%{http_code}" "https://www.dreamfield.top/api/v1/health"',
      commandStdout: '200',
      isOpen: false
    },
    {
      id: 4,
      sender: 'assistant',
      text: lang === 'zh'
        ? '检查完毕！已验证您的 DreamField 官方通道配置：\n\n- **连接状态**: 正常联通 (HTTP 200, 响应 28ms)\n- **映射模型**: `GLM-5.1` (实时混合专家系统架构)\n- **安全等级**: 已通过 OS 内置特权 Keychain 加密存储密钥。'
        : 'Verification completed successfully! Here is the status of your mapped DreamField endpoint:\n\n- **Status**: Live (HTTP 200, 28ms latency)\n- **Active Endpoint Model**: `GLM-5.1` (Mixed-Expert architecture)\n- **Security**: The credential is safe, sealed under OS keychain encryption.'
    }
  ],
  'github-profile': [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '如何把我的本地修改同步到 GitHub Profile？'
        : 'How can I synchronize my local workspace edits to my GitHub Profile repository?'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '用户想知道如何推送。我们检查下当前目录下的 git 配置和 github-sync 插件状态。'
        : 'The user wants to synchronize profile contents. Checking default Git configuration and the status of github-sync plugin.'
    },
    {
      id: 3,
      sender: 'tool',
      commandType: 'bash',
      commandCode: 'git remote -v',
      commandStdout: 'origin  https://github.com/GoDiao/dreamcoder.git (fetch)\norigin  https://github.com/GoDiao/dreamcoder.git (push)',
      isOpen: false
    },
    {
      id: 4,
      sender: 'assistant',
      text: lang === 'zh'
        ? '同步已验证就绪。由于您尚未在「插件中心」开启 `github-sync` 自动推送扩展，您当前需要手动进行 Git 提交。或者，您可以一键在设置面板开启 **`GitHub Sync`** 插件来实现底层变更实时感知和自动推送。'
        : 'Workspace tracking verified! However, the automated push extension `github-sync` is currently inactive. You can commit manual git changes, or toggle the **`GitHub Sync`** plugin under the Plugins setting module to enable seamless remote mirroring.'
    }
  ],
  'MAI-Thinking': [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '目前 Multi-Agent 多智能体思考时的高阶推理强度是多少？'
        : 'What is the current computing intensity for Multi-Agent high-order reasoning algorithms?'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '获取当前偏好设置中关于推理强度的设定，渲染状态给用户。'
        : 'Fetching preference metrics regarding active reasoning strength, presenting to user.'
    },
    {
      id: 3,
      sender: 'assistant',
      text: lang === 'zh'
        ? '当前的推理强度设为 **「中 (Medium)」**，单次审查会话分析时延约 450ms。这为大多数代码评审、AST树级别冲突校验和重构提供最佳性价表现。您可以在通用配置板块中调整该设置，拉动至「最高 (Max)」来获取顶配多模态逻辑深度。'
        : 'The active intensity is mapped to **`Medium`**, with a localized static review analysis time of ~450ms. This provides optimized throughput for code design AST checks. You can scale this up to `Max` under Themes/General Settings for complete logical depth.'
    }
  ],
  'Open-Agent-in-Browser': [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '在端侧无阻碍解析 UIA Tree 有什么优势？'
        : 'What is the distinct benefit of performing UIA Tree parsing on local runtimes?'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '分析和展示无障碍树节点匹配在 Computer Use 板块比全像素视觉多模态定位更优秀的理由。'
        : 'Analyzing advantages of direct element-node targeting (UIA accessibility tree) compared to pixel coordinate classifiers in Computer Use.'
    },
    {
      id: 3,
      sender: 'assistant',
      text: lang === 'zh'
        ? '相比高密度的全截屏视觉识别匹配（Vision Model），端侧 UIA Tree 具备以下压倒性优势：\n\n1. **极速响应**: 毫秒感知。省去了向云端多模态大模型上传富像素图片的延迟，减少约 40% 的 Token 开销。\n2. **精准无阻碍**: 直接读取操作系统层级 ElementID，完全隔离坐标误差，杜绝点击偏移。\n3. **隐私物理隔绝**: 不泄露屏幕可视化内容。'
        : 'Compared to visual frame grabbing schemes, structural node targeting (UIA accessibility tree) yields critical advantages:\n\n1. **Superb Efficiency**: Consumes up to 40% fewer context Tokens by bypassing high-resolution full-frame uploads.\n2. **Absolute Accuracy**: Targets precise element tags from the OS subtree, completely bypassing scaling and offset errors.\n3. **Absolute Privacy**: No video data stream flows to remote clouds, maintaining physical data isolation.'
    }
  ],
  'blog-source': [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '帮我查找当前静态博客工作目录下最旧的 3 篇 Markdown 文章'
        : 'Help me find the 3 oldest Markdown articles within current blog-source repository.'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '检索博客静态资源目录。我们需要检查 Markdown 文件的创建时间。'
        : 'Scanning local repository path. Checking attributes of files with markdown extensions.'
    },
    {
      id: 3,
      sender: 'tool',
      commandType: 'bash',
      commandCode: 'find . -name "*.md" -type f -exec stat -c "%y %n" {} + | sort | head -n 3',
      commandStdout: '2024-01-10 10:20:01 ./content/posts/welcome-to-hugo.md\n2024-03-12 11:45:12 ./content/posts/tailwind-v4-guide.md\n2024-05-24 15:30:40 ./content/posts/tauri-rust-desktop.md',
      isOpen: false
    },
    {
      id: 4,
      sender: 'thought',
      text: lang === 'zh'
        ? '已查找到三篇最旧的博客，将结果格式化呈递给用户。'
        : 'Identified the 3 heritage articles. Formatting search records into discrete lists.'
    },
    {
      id: 5,
      sender: 'assistant',
      text: lang === 'zh'
        ? '已检索完毕，帮您整理出当前目录中时间最早的 3 篇 Markdown 文章：\n\n1. **`welcome-to-hugo.md`** (发布于 2024-01)\n2. **`tailwind-v4-guide.md`** (发布于 2024-03)\n3. **`tauri-rust-desktop.md`** (发布于 2024-05)'
        : 'Scans complete! Here are the three oldest markdown articles located in your blog source directories:\n\n1. **`welcome-to-hugo.md`** (Indexed Jan 2024)\n2. **`tailwind-v4-guide.md`** (Indexed Mar 2024)\n3. **`tauri-rust-desktop.md`** (Indexed May 2024)'
    }
  ],
  MiniCode: [
    {
      id: 1,
      sender: 'user',
      text: lang === 'zh'
        ? '开启端侧 Rust 编译主程序有什么安全限制吗？'
        : 'What safety limits apply when triggering local Rust compilation modules?'
    },
    {
      id: 2,
      sender: 'thought',
      text: lang === 'zh'
        ? '我们需要描述安全防护机制 (Shell Safe Guard) 对有害和高危代码指令的物理拦截机制。'
        : 'Describing physical blocking mechanisms of Shell Safe Guard on hazardous inputs during compilation cycles.'
    },
    {
      id: 3,
      sender: 'assistant',
      text: lang === 'zh'
        ? '具有非常健全的隔离机制。DreamCoder 内置了原生系统级代码安全哨兵「Shell Safe Guard」：\n\n- **权限边界阻断**: 绝对不可操作磁盘非信任用户目录、修改系统全局 host 表，或对核心 network 驱动进行绕越提权。\n- **高危指令拦截**: 任何类似于 `rm -rf /`，或者是执行可能危及宿主核心文件的操作都会被强力切断。开启「自动执行」也绝不例外，会弹出红色哨兵卡片终止该事务。'
        : 'Rest assured, your workspace is heavily shielded! DreamCoder has localized a raw security compiler barrier "Shell Safe Guard" that features:\n\n- **Absolute Sandboxing**: Access directed outside user project folders, or modifications addressing system host tables/network drivers are instantly quarantined.\n- **Heuristic Threat Interception**: Terminal directives containing malicious scripts (e.g., recursive root deletions) will trigger physical interception. A red security sentinel modal will rise even if auto-execution is toggled.'
    }
  ]
});

const getInitialProviders = (lang: 'zh' | 'en') => [
  { id: '1', name: lang === 'zh' ? 'DreamField 官方通道' : 'DreamField Official Link', company: lang === 'zh' ? 'DreamField 官方' : 'DreamField Official', isDefault: true, url: 'https://www.dreamfield.top', model: 'GLM-5.1', status: 'connected' },
  { id: '2', name: lang === 'zh' ? 'MIMO 聚合通道' : 'MIMO Aggregation Channel', company: 'MIMO Cloud Channel', isDefault: false, url: 'https://token-plan-sgp.xiaomimimo.com', model: 'mimo-v2.5-pro', status: 'connected' },
  { id: '3', name: lang === 'zh' ? '本地 Ollama 离线端' : 'Local Ollama Client', company: 'Localhost Engine', isDefault: false, url: 'http://127.0.0.1:11434', model: 'DeepSeek-R1-8B', status: 'connected' }
];

const getInitialPlugins = (lang: 'zh' | 'en') => [
  { id: 'autoresearch', name: 'autoresearch', type: lang === 'zh' ? '用户' : 'User', isEnabled: true, desc: 'Autonomous research orchestration using a two-loop architecture. Fast experiment iteration inside isolated environments.', version: 'v1.0.0' },
  { id: 'frontend-design', name: 'frontend-design', type: lang === 'zh' ? '用户' : 'User', isEnabled: true, desc: 'Frontend design skill for UI/UX high fidelity implementation. Automatically paired with Tailwind CSS.', version: 'v2.1.3' },
  { id: 'impeccable', name: 'impeccable', type: lang === 'zh' ? '用户' : 'User', isEnabled: true, desc: 'Design fluency and beautiful font pairing helper for modern frontend developments.', version: 'v3.5.0' },
  { id: 'oh-my-claudecode', name: 'oh-my-claudecode', type: lang === 'zh' ? '用户' : 'User', isEnabled: true, desc: 'Multi-agent orchestration system and custom slash commands manager for local workflows.', version: 'v4.14.4' },
  { id: 'sqlite-explorer', name: 'sqlite-explorer', type: lang === 'zh' ? '内置' : 'Built-in', isEnabled: true, desc: 'Realtime query and schema generator for local database entities. Supports zero configurations.', version: 'v1.2.0' },
  { id: 'shell-safe-guard', name: 'shell-safe-guard', type: lang === 'zh' ? '内置' : 'Built-in', isEnabled: true, desc: 'Intercepts privileged terminal scripts and prevents destructive system actions.', version: 'v0.9.1' },
  { id: 'github-sync', name: 'github-sync', type: lang === 'zh' ? '用户' : 'User', isEnabled: false, desc: 'Pushes code reviews and changes to GitHub pages or remote trunks automatically.', version: 'v1.4.0' }
];

export default function AppShowcase({ initialTab = 'main' }: AppShowcaseProps) {
  const { lang, setLang } = useLanguage();

  // Navigation states
  const [viewMode, setViewMode] = useState<'chat' | 'settings'>(initialTab === 'main' ? 'chat' : 'settings');
  const [activeTab, setActiveTab] = useState<string>(initialTab === 'main' ? 'main' : initialTab); // Top tab level
  const [currentSettingsTab, setCurrentSettingsTab] = useState<string>(initialTab === 'main' ? 'permissions' : initialTab);
  
  // Interactive global theme state inside the simulator
  const [simulatorTheme, setSimulatorTheme] = useState<SimTheme>('warm');
  const [selectedLanguage, setSelectedLanguage] = useState<'zh' | 'en'>(lang);
  const [responseLanguage, setResponseLanguage] = useState<string>('default');
  const [reasoningStrength, setReasoningStrength] = useState<'low' | 'medium' | 'high' | 'max'>('medium');
  const [thinkingModeEnabled, setThinkingModeEnabled] = useState<boolean>(true);
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState<boolean>(true);

  // Keyboard shortcut or notification alerts
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  // Interactive Simulator States for Workspace (main.png)
  const [simActiveSession, setSimActiveSession] = useState('PAI_dev');
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Seed default dataset based on initial selected language
  const [sessionMessages, setSessionMessages] = useState<Record<string, any[]>>(() => getInitialSessionMessages(lang));
  const [simProviders, setSimProviders] = useState(() => getInitialProviders(lang));
  const [pluginsList, setPluginsList] = useState(() => getInitialPlugins(lang));

  // Sync state whenever language updates globally
  useEffect(() => {
    setSessionMessages(getInitialSessionMessages(lang));
    setSimProviders(getInitialProviders(lang));
    setPluginsList(getInitialPlugins(lang));
    setSelectedLanguage(lang);
  }, [lang]);

  const simMessages = sessionMessages[simActiveSession] || [
    { 
      id: 9999, 
      sender: 'system-error', 
      text: lang === 'zh'
        ? `已锁定项目工作目录 [ ${simActiveSession} ] 终端模块。开始极速检索。`
        : `Locked project workspace [ ${simActiveSession} ] core terminal. Bootstrapping analysis digests.`
    }
  ];

  const setSimMessages = (updater: any[] | ((prev: any[]) => any[])) => {
    setSessionMessages(prev => {
      const currentMsgs = prev[simActiveSession] || [
        { 
          id: 9999, 
          sender: 'system-error', 
          text: lang === 'zh'
            ? `已锁定项目工作目录 [ ${simActiveSession} ] 终端模块。开始极速检索。`
            : `Locked project workspace [ ${simActiveSession} ] core terminal. Bootstrapping analysis digests.`
        }
      ];
      const nextMsgs = typeof updater === 'function' ? updater(currentMsgs) : updater;
      return {
        ...prev,
        [simActiveSession]: nextMsgs
      };
    });
  };

  const toggleToolOpen = (msgId: number) => {
    setSimMessages(prev => prev.map(m => m.id === msgId ? { ...m, isOpen: !m.isOpen } : m));
  };
  
  const [newProvName, setNewProvName] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');
  const [isAddingProv, setIsAddingProv] = useState(false);

  // Permissions Settings (Screenshot 1)
  const [permissionMode, setPermissionMode] = useState<'ask' | 'accept-edit' | 'plan-only' | 'skip-all'>('skip-all');

  // States for Computer Use Simulator
  const [isComputerUseEnabled, setIsComputerUseEnabled] = useState(true);
  const [computerUseMode, setComputerUseMode] = useState<'vision' | 'uia'>('uia');
  const [pythonPath, setPythonPath] = useState('C:\\Users\\26455\\.pyenv\\shims\\python.exe');
  const [checkingCompUse, setCheckingCompUse] = useState(false);

  // States for MCP Skills Settings (Screenshot 3)
  const [searchSkill, setSearchSkill] = useState('');
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<string>('autoresearch');

  const togglePlugin = (id: string) => {
    setPluginsList(prev => prev.map(p => p.id === id ? { ...p, isEnabled: !p.isEnabled } : p));
    triggerToast(lang === 'zh' 
      ? `插件状态已暂存。请点击右侧「应用变更」将其写入 Tauri 引擎运行态。`
      : `Plugin status buffered. Click "Apply Changes" on the right to commit into the Tauri engine runtime.`);
  };

  const handleApplyPluginChanges = () => {
    triggerToast(lang === 'zh'
      ? '🌟 插件状态已热部署！Tauri 核心引擎完成后台 Stdio 管道重构。'
      : '🌟 Plugins hot-deployed! Tauri core engine completed stdio pipeline restructuring.');
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Trigger automated greeting print in simulation workspace
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || isTyping) return;
    
    const userMsg = inputVal;
    setInputVal('');
    setIsTyping(true);
    
    const baseId = Date.now();
    
    // 1. Append User Message
    setSimMessages(prev => [...prev, { id: baseId, sender: 'user', text: userMsg }]);
    
    // 2. Simulate typing and multi-agent thoughts and tool calls!
    setTimeout(() => {
      // Treat "clear" or "清除" to reset messages list
      if (userMsg.toLowerCase().includes('clean') || userMsg.includes('清除') || userMsg.toLowerCase().includes('clear')) {
        setSimMessages([
          { 
            id: Date.now(), 
            sender: 'system-error', 
            text: lang === 'zh'
              ? '控制台会话状态已复位。您可以发送指令测试端侧智能引擎。'
              : 'Console session state reset. You can send prompts to test the local engine.'
          }
        ]);
        setIsTyping(false);
        return;
      }

      // Add Thought 1
      setSimMessages(prev => [...prev, {
        id: baseId + 1,
        sender: 'thought',
        text: lang === 'zh'
          ? `用户发送指令「${userMsg}」。让我先调用本地 AST 分析与文件目录扫描。`
          : `User issued directive "${userMsg}". Let me invoke local AST analysis and file tree scans.`
      }]);
      
      setTimeout(() => {
        // Add Tool Bash Block
        const command = userMsg.toLowerCase().includes('rust') || userMsg.toLowerCase().includes('main')
          ? 'cargo check --message-format=json'
          : `grep -rI --include='*.ts' '${userMsg}' .`;
        
        const output = userMsg.toLowerCase().includes('rust') || userMsg.toLowerCase().includes('main')
          ? '{\n  "reason": "compiler-message",\n  "package_id": "dreamcoder-core 0.1.0 (path+file:///src-tauri)",\n  "target": { "kind": ["bin"], "name": "dreamcoder-runtime" },\n  "message": {\n    "rendered": "compilation finished successfully",\n    "level": "info"\n  }\n}'
          : `[DreamCoder Scanner Search Results]\n  ./src/components/AppShowcase.tsx: matched key query\n  ./src/App.tsx: core binding hooks found\n  Total matches: 2 files, 0 errors, 1 warnings (stale reference).`;

        setSimMessages(prev => [...prev, {
          id: baseId + 2,
          sender: 'tool',
          commandType: 'bash',
          commandCode: command,
          commandStdout: output,
          isOpen: false
        }]);
        
        setTimeout(() => {
          // Add Thought 2
          setSimMessages(prev => [...prev, {
            id: baseId + 3,
            sender: 'thought',
            text: lang === 'zh'
              ? `本地扫描与 AST 验证无误，开始为用户完成指示「${userMsg}」的本地变更封装。`
              : `Local scan and AST verification passed. Packaging workspace changes for user prompt "${userMsg}".`
          }]);
          
          setTimeout(() => {
            // Add Assistant Action Reply
            let replyText = lang === 'zh'
              ? `我已经成功联动端侧编译器，为您分析并完成了「${userMsg}」相关的解析：\n\n• 当前工程节点：E:\\AProject\\TianX\\Personal\\PAI_dev\n• 集成沙箱结果：0个异常阻断，安全放行。\n\n需要我一键提交或运行本地测试用例吗？`
              : `I have successfully integrated with the native compiler to analyze and process "${userMsg}":\n\n• Active Node: E:\\AProject\\TianX\\Personal\\PAI_dev\n• Sandbox Status: 0 exceptions block, safely authorized.\n\nWould you like me to submit changes or execute local tests?`;
            
            if (userMsg.toLowerCase().includes('hello') || userMsg.includes('你好')) {
              replyText = lang === 'zh'
                ? `你好！我是 DreamCoder 开源桌面 GUI 的端侧 AI 助手：\n\n• 我能与你本机的编译器、git、shell 及虚拟沙盒完美结合。\n• 绝不上传隐私代码，100% 本地存储分析！\n\n测试完毕。我现在已经安全就绪，随时等候您的下一步工作调度。`
                : `Hello! I am the local AI companion of the DreamCoder open-source desktop GUI:\n\n• I integrate seamlessly with your local compilers, git, shell, and virtual sandboxes.\n• No cloud data transfers—100% local private analytics!\n\nI am locked, loaded, and awaiting your command.`;
            } else if (userMsg.includes('theme') || userMsg.includes('主题')) {
              replyText = lang === 'zh'
                ? `收到！DreamCoder 工作区提供多种精心调校的色域（怀旧暖色、深灰色、纯白、暗夜蓝等）。\n\n你可以点击左侧底部的「⚙️ 安全设置」，在「通用主题」分册内一键热切换！`
                : `Understood! DreamCoder workspace features beautiful pre-calibrated palettes (Warm Terracotta, Slate Dark, Pure White, Midnight Sky, etc.).\n\nSimply click "⚙️ Settings" on the bottom left and explore themes under "General Settings" tab!`;
            }

            setSimMessages(prev => [...prev, {
              id: baseId + 4,
              sender: 'assistant',
              text: replyText,
              actionButtons: true
            }]);
            
            setIsTyping(false);
          }, 850);
        }, 600);
      }, 700);
    }, 450);
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [simMessages, isTyping]);

  const triggerCompCheck = () => {
    setCheckingCompUse(true);
    setTimeout(() => {
      setCheckingCompUse(false);
      triggerToast(lang === 'zh'
        ? '🎉 Python 3.11 解释器与虚拟沙箱环境检测联动通过！状态就绪。'
        : '🎉 Python 3.11 interpreter and virtual sandbox environment tests passed! Ready.');
    }, 1100);
  };

  const addCustomProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProvName) return;
    setSimProviders(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        name: newProvName,
        company: lang === 'zh' ? '自定义私有 Key' : 'Custom Private Key',
        isDefault: false,
        url: newProvUrl || 'https://api.openai-proxy.com/v1',
        model: 'deepseek-chat / gpt-4o',
        status: 'connected'
      }
    ]);
    triggerToast(lang === 'zh'
      ? `服务商 ${newProvName} 已于本地配置列表就绪！`
      : `Provider ${newProvName} is now ready in the local configuration tree!`);
    setNewProvName('');
    setNewProvUrl('');
    setIsAddingProv(false);
  };

  // Mock skills database (Screenshot 3 style)
  const skillsList = [
    { id: 'academic-slides', version: 'v1.4.2', title: 'academic-slides', count: lang === 'zh' ? '用户 58' : 'User 58', views: lang === 'zh' ? '175,031 次查看' : '175,031 views', desc: 'Use this skill for creating or refining an academic slide deck and the talk built around it. Handles thesis defense prep, conference lectures, and paper-to-slides transformations with meticulous typography layouts.', type: 'user' },
    { id: 'autoresearch', version: 'v1.0.0', title: 'autoresearch', count: lang === 'zh' ? '插件 58' : 'Plugin 58', views: lang === 'zh' ? '161,126 次查看' : '161,126 views', desc: 'Orchestrates end-to-end autonomous AI research projects using a two-loop workspace architecture. Inner loop runs rapid experiment compilers, while outer loop synthesizes patterns and redirects research priorities.', type: 'plugin' },
    { id: 'agent-browser', version: 'v0.9.1', title: 'Agent Browser', count: lang === 'zh' ? '用户 58' : 'User 58', views: lang === 'zh' ? '2,638 次查看' : '2,638 views', desc: 'A fast Rust-based headless web navigator that enables artificial agents to browse webpages, double click elements, fill text containers, and snapshot viewports with pixel accuracy.', type: 'user' },
    { id: 'frontend-design', version: 'v3.2.0', title: 'frontend-design', count: lang === 'zh' ? '插件 58' : 'Plugin 58', views: lang === 'zh' ? '1,079 次查看' : '1,079 views', desc: 'Creates distinctive, high-fidelity responsive frontend elements based on refined custom design-spec guidelines. Fully optimizes layouts with Tailwind CSS and rejects raw template aesthetics.', type: 'plugin' },
    { id: 'impeccable', version: 'v3.5.0', title: 'impeccable', count: lang === 'zh' ? '用户 58' : 'User 58', views: lang === 'zh' ? '8,421 次查看' : '8,421 views', desc: 'Guarantees absolute design fluency and typography pacing for user-facing applications. Optimizes negative space and editorial pairings automatically.', type: 'user' },
    { id: 'sqlite-viewer', version: 'v1.1.0', title: 'sqlite-viewer', count: lang === 'zh' ? '内置 1' : 'Built-in 1', views: lang === 'zh' ? '12,940 次查看' : '12,940 views', desc: 'Provides standard database structure exploration tool for local sqlite databases. Enables rapid data insertion and migration debugging.', type: 'built-in' }
  ];

  const filteredSkills = skillsList.filter(s => 
    s.title.toLowerCase().includes(searchSkill.toLowerCase()) || 
    s.desc.toLowerCase().includes(searchSkill.toLowerCase())
  );

  // Jump from top tabs directly to sub views
  const handleTopTabNav = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'main') {
      setViewMode('chat');
    } else {
      setViewMode('settings');
      setCurrentSettingsTab(tab);
    }
  };

  // Generate dynamic theme class overrides for the simulated app window
  const getThemeClasses = () => {
    switch (simulatorTheme) {
      case 'dark':
        return {
          bg: 'bg-[#151515] text-[#e0e0e0] border-[#2a2a2a]',
          sidebar: 'bg-[#1a1a1a] border-[#2a2a2a] text-[#a0a0a0]',
          innerNav: 'bg-[#1c1c1c] border-[#2c2c2c] text-[#b0b0b0]',
          card: 'bg-[#222222] border-[#2d2d2d] text-[#e0e0e0]',
          input: 'bg-[#181818] border-[#2e2e2e] text-white',
          textTitle: 'text-white',
          textMuted: 'text-gray-400',
          btnPrimary: 'bg-brand-caramel text-white hover:bg-brand-caramel/90',
          btnSecondary: 'bg-[#2a2a2a] border-[#3a3a3a] text-white hover:bg-[#333]'
        };
      case 'midnight':
        return {
          bg: 'bg-[#0f111a] text-[#ccd6f6] border-[#1b2234]',
          sidebar: 'bg-[#131725] border-[#1b2234] text-[#8892b0]',
          innerNav: 'bg-[#141b2e] border-[#1d2740] text-[#a8b2d1]',
          card: 'bg-[#182035] border-[#222d4a] text-[#ccd6f6]',
          input: 'bg-[#0b0c13] border-[#1a233b] text-white',
          textTitle: 'text-[#64ffda]',
          textMuted: 'text-[#8892b0]',
          btnPrimary: 'bg-[#64ffda] text-[#0a192f] hover:bg-[#64ffda]/80',
          btnSecondary: 'bg-[#172a45] border-[#233554] text-[#ccd6f6] hover:bg-[#303c6c]'
        };
      case 'emerald':
        return {
          bg: 'bg-[#0b1b17] text-[#e1ece8] border-[#153028]',
          sidebar: 'bg-[#0e221d] border-[#153028] text-[#a4beb6]',
          innerNav: 'bg-[#0f2721] border-[#17382d] text-[#abc4be]',
          card: 'bg-[#133129] border-[#1d473a] text-[#e1ece8]',
          input: 'bg-[#060e0c] border-[#122e25] text-[#b2f5ea]',
          textTitle: 'text-[#3ffd9c]',
          textMuted: 'text-[#9cb5ae]',
          btnPrimary: 'bg-[#3ffd9c] text-[#0a1b15] hover:bg-[#3ffd9c]/80',
          btnSecondary: 'bg-[#133d32] border-[#1f5546] text-[#e1ece8] hover:bg-[#1f5c4b]'
        };
      case 'amber':
        return {
          bg: 'bg-[#170e06] text-[#ffb03a] border-[#2d1b0d]',
          sidebar: 'bg-[#1d1108] border-[#2d1b0d] text-[#b88040]',
          innerNav: 'bg-[#21140a] border-[#36210f] text-[#c48d4f]',
          card: 'bg-[#291a0c] border-[#422913] text-[#ffb03a]',
          input: 'bg-[#0a0602] border-[#2c1c0f] text-[#ffcf4f]',
          textTitle: 'text-[#ff9d23]',
          textMuted: 'text-[#b87c3a]',
          btnPrimary: 'bg-[#ff9d23] text-[#130a03] hover:bg-[#ffb33a]',
          btnSecondary: 'bg-[#331f0d] border-[#4a2e14] text-[#ffb03a] hover:bg-[#4a2e14]'
        };
      case 'light':
        return {
          bg: 'bg-white text-gray-800 border-gray-200',
          sidebar: 'bg-gray-50 border-gray-200 text-gray-600',
          innerNav: 'bg-gray-100 border-gray-200 text-gray-700',
          card: 'bg-gray-200/50 border-gray-300 text-gray-800',
          input: 'bg-white border-gray-300 text-gray-900',
          textTitle: 'text-gray-900',
          textMuted: 'text-gray-500',
          btnPrimary: 'bg-gray-900 text-white hover:bg-black',
          btnSecondary: 'bg-white border-gray-200 text-gray-850 hover:bg-gray-50'
        };
      case 'warm':
      default:
        return {
          bg: 'bg-[#faf9f6] text-[#2c2724] border-brand-border',
          sidebar: 'bg-[#f5f2e9] border-[#e6decb] text-[#554f4b]',
          innerNav: 'bg-[#f0ebd9] border-[#dfd4bd] text-[#4f4944]',
          card: 'bg-white border-brand-border text-[#2c2724]',
          input: 'bg-[#faf9f6] border-brand-border text-brand-text-title',
          textTitle: 'text-brand-text-title',
          textMuted: 'text-brand-text-muted',
          btnPrimary: 'bg-brand-caramel text-white hover:bg-brand-caramel/95',
          btnSecondary: 'bg-white border-brand-border text-brand-text-title hover:bg-[#faf9f6]'
        };
    }
  };

  const currentTheme = getThemeClasses();

  return (
    <div id="interactive-workspace" className="w-full bg-brand-bg-secondary border border-brand-border rounded-xl overflow-hidden shadow-xs hover:shadow-xs transition duration-300 relative select-none">
      
      {/* Simulation Selector Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg-card gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex h-2 w-2 rounded-full bg-brand-success animate-pulse"></span>
            <span className="text-xs font-mono font-medium text-brand-caramel tracking-wider uppercase">
              {lang === 'zh' ? '跨屏沙箱 UI 交互终端容器' : 'Multi-Screen Sandbox UI Container'}
            </span>
          </div>
          <h3 className="text-xl serif-display text-brand-text-title font-semibold">
            {lang === 'zh' ? 'DreamCoder 客户端交互演示沙盘' : 'DreamCoder Client Interactive Demo Sandbox'}
          </h3>
        </div>
        
        {/* Navigation Tabs covering all mocked up settings and workspace screens */}
        <div className="flex flex-wrap gap-1 p-1 bg-brand-bg-primary border border-brand-border rounded-lg text-xs font-mono">
          <button 
            onClick={() => handleTopTabNav('main')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'chat' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Terminal size={12} />
            <span>💻 {lang === 'zh' ? '主会话终端' : 'Main Session'}</span>
          </button>
          <button 
            onClick={() => handleTopTabNav('permissions')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'settings' && currentSettingsTab === 'permissions' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Shield size={12} />
            <span>🛡️ {lang === 'zh' ? '权限控制 (图1)' : 'Privileges (Fig 1)'}</span>
          </button>
          <button 
            onClick={() => handleTopTabNav('general')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'settings' && currentSettingsTab === 'general' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Sliders size={12} />
            <span>⚙️ {lang === 'zh' ? '通用主题 (图2)' : 'Themes (Fig 2)'}</span>
          </button>
          <button 
            onClick={() => handleTopTabNav('skills')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'settings' && currentSettingsTab === 'skills' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Wrench size={12} />
            <span>📜 {lang === 'zh' ? '技能浏览器 (图3)' : 'Skills Browser (Fig 3)'}</span>
          </button>
          <button 
            onClick={() => handleTopTabNav('plugins')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'settings' && currentSettingsTab === 'plugins' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Layers size={12} />
            <span>🔌 {lang === 'zh' ? '插件中心 (图4)' : 'Plugins Center (Fig 4)'}</span>
          </button>
          <button 
            onClick={() => handleTopTabNav('token')}
            className={`px-3 py-1.5 rounded-md transition-all font-medium flex items-center gap-1 cursor-pointer ${viewMode === 'settings' && currentSettingsTab === 'token' ? 'bg-brand-caramel text-brand-bg-primary' : 'text-brand-text-muted hover:text-brand-text-title'}`}
          >
            <Calendar size={12} />
            <span>🔥 {lang === 'zh' ? 'Token 用量 (图5)' : 'Token Usage (Fig 5)'}</span>
          </button>
        </div>
      </div>

      {/* Toast Notification helper inside sandbox */}
      {toastMessage && (
        <div className="absolute top-20 right-8 z-50 bg-[#7a3e1b] text-[#fbfbf8] border border-brand-border/30 rounded-xl p-3 px-4 font-mono text-xs flex items-center gap-2 shadow-lg animate-slide-in-right">
          <Sparkle size={13} className="text-brand-caramel animate-spin-slow shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Simulator Frame (Tauri App Mockup) */}
      <div className="w-full bg-[#efe8de] p-3 md:p-6" id="tauri-app-viewport">
        
        {/* Device Shell - Dynamically applying theme override styles! */}
        <div className={`w-full border shadow-md overflow-hidden text-sm flex flex-col min-h-[580px] rounded-2xl transition-all duration-300 font-sans ${currentTheme.bg} ${currentTheme.bg.split(' ')[0] === 'bg-white' ? 'border-gray-200 shadow-xl' : 'border-brand-border'}`}>
          
          {/* App Window Title Bar */}
          <div className={`flex items-center justify-between px-4 py-2 bg-[#f1ebd3]/30 border-b select-none ${simulatorTheme === 'dark' ? 'bg-[#181818]/60 border-[#222]' : simulatorTheme === 'midnight' ? 'bg-[#0a0c10]/40 border-[#1a1f33]' : 'border-brand-border/60'}`}>
            {/* macOS styled window dots */}
            <div className="flex items-center gap-1.5 w-1/4">
              <span className="w-3 h-3 rounded-full bg-red-400 block shrink-0"></span>
              <span className="w-3 h-3 rounded-full bg-yellow-400 block shrink-0"></span>
              <span className="w-3 h-3 rounded-full bg-green-400 block shrink-0"></span>
              <span className={`ml-3 text-[10px] font-mono hidden md:inline-block ${currentTheme.textMuted}`}>DreamCoder Native • v0.3.0 GUI</span>
            </div>
            
            {/* Filepath workspace header indicator */}
            <div className={`flex items-center gap-2 text-xs font-mono bg-white/50 backdrop-blur-xs px-3 py-1 rounded border overflow-hidden max-w-sm shrink text-ellipsis whitespace-nowrap ${simulatorTheme === 'dark' ? 'bg-black/30 border-gray-800' : 'border-brand-border/50'}`}>
              <Folder size={11} className="text-brand-caramel shrink-0" />
              <span className="truncate">C:\Users\26455\dreamcoder-demo</span>
            </div>
            
            {/* App Header widgets */}
            <div className="flex items-center gap-2.5 w-1/4 justify-end text-brand-text-muted">
              <button 
                onClick={() => triggerToast(lang === 'zh' ? `本机测试运行：沙盒暂载 116 款 MCP 技能和 8 款插件。` : `Native analysis metrics: Loaded 116 MCP skills and 8 plugin models.`)} 
                className="hover:text-brand-caramel p-0.5 rounded cursor-pointer transition-colors"
                title={lang === 'zh' ? '诊断' : 'Diagnose'}
              >
                <HelpCircle size={14} />
              </button>
              <button 
                onClick={() => {
                  setSimulatorTheme(prev => prev === 'warm' ? 'dark' : prev === 'dark' ? 'midnight' : prev === 'midnight' ? 'emerald' : prev === 'emerald' ? 'amber' : prev === 'amber' ? 'light' : 'warm');
                  triggerToast(lang === 'zh'
                    ? `配景主题已换至: ${simulatorTheme === 'warm' ? '深邃灰暗' : simulatorTheme === 'dark' ? '星际深邃' : simulatorTheme === 'midnight' ? '翡翠青绿' : simulatorTheme === 'emerald' ? '秋日琥珀' : simulatorTheme === 'amber' ? '极简亮白' : '怀旧暖色'}，多色工作区已渲染。`
                    : `Palette modified to: ${simulatorTheme === 'warm' ? 'Dark Gray' : simulatorTheme === 'dark' ? 'Midnight Blue' : simulatorTheme === 'midnight' ? 'Emerald Green' : simulatorTheme === 'emerald' ? 'Amber Rust' : simulatorTheme === 'amber' ? 'Minimal Light' : 'Warm Clay'}`);
                }}
                className="hover:text-brand-caramel p-0.5 rounded"
                title={lang === 'zh' ? '切换主题' : 'Switch Theme'}
              >
                <Sliders size={14} />
              </button>
              <button className="hover:text-brand-caramel p-0.5" title={lang === 'zh' ? '源码查看' : 'View Code'}>
                <Terminal size={14} />
              </button>
            </div>
          </div>

          {/* Main layout frame */}
          <div className="flex-1 flex flex-col md:flex-row min-h-[500px]">
            
            {/* FAR-LEFT SIDEBAR (The original Folders drawer layout) */}
            <div className={`w-full md:w-[190px] border-r flex flex-col justify-between shrink-0 p-3 select-none transition-colors ${currentTheme.sidebar}`}>
              <div className="space-y-4">
                
                {/* Brand title block */}
                <div className="flex items-center justify-between pb-2 border-b border-brand-border/30">
                  <div className="flex items-center gap-2 font-serif font-black tracking-tight text-[15px] text-brand-text-title text-brand-caramel">
                    <span className="bg-[#b87351] text-[#faf9f6]/95 h-5 w-5 rounded flex items-center justify-center font-sans text-xs font-bold shrink-0">D</span>
                    DreamCoder
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 bg-white/35 rounded-full border border-brand-border/30">GUI v0.3</span>
                </div>

                {/* Left quick actions */}
                <div className="space-y-1">
                  <button 
                    onClick={() => {
                      setViewMode('chat');
                      setActiveTab('main');
                      setSimActiveSession('PAI_dev');
                      triggerToast(lang === 'zh' ? '已切换至 [PAI_dev] 主会话控制端！' : 'Switched to [PAI_dev] chat context!');
                    }}
                    className={`w-full flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-2 rounded-lg border transition-all text-left ${viewMode === 'chat' && simActiveSession === 'PAI_dev' ? 'bg-[#b87351] text-[#faf9f6]/95 border-[#b87351] shadow-xs' : 'bg-white/40 border-brand-border/50 hover:bg-white text-[#2c2724]'}`}
                  >
                    <Plus size={12} />
                    {lang === 'zh' ? '新建会话' : 'New Session'}
                  </button>
                  <button 
                    onClick={() => {
                      setViewMode('settings');
                      setCurrentSettingsTab('token');
                      triggerToast(lang === 'zh' ? '已载入本地 Token 数据库智能记录分析。' : 'Loaded local token database diagnostics.');
                    }}
                    className="w-full flex items-center gap-1.5 text-[11px] font-mono px-2 py-1.5 rounded-md hover:bg-white/30 text-[#867e76] transition-colors text-left font-medium"
                  >
                    <Clock size={11} className="text-[#b87351]" />
                    <span>{lang === 'zh' ? '定时统计 (Daily)' : 'Daily Metrics'}</span>
                  </button>
                </div>

                {/* Session search */}
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder={lang === 'zh' ? '搜索会话...' : 'Search Sessions...'} 
                    disabled
                    className="w-full p-1 pl-6 bg-white/50 border border-[#dfd6c2]/40 rounded text-[10px] font-mono focus:outline-hidden"
                  />
                  <Search size={10} className="absolute left-2 top-2 text-[#867e76]" />
                </div>

                {/* Local works/Folders lists exactly like in screenshot */}
                <div className="space-y-1">
                  <div className="text-[9px] font-bold text-brand-text-muted tracking-wider uppercase font-mono px-1">
                    {lang === 'zh' ? '本地项目工作区' : 'Local Project Workspaces'}
                  </div>
                  <div className="space-y-0.5 text-xs font-mono max-h-[170px] overflow-y-auto pr-0.5">
                    {[
                      { name: 'PAI_dev', desc: lang === 'zh' ? '运行中' : 'Active' },
                      { name: 'dreamfield', desc: lang === 'zh' ? '同步中' : 'Syncing' },
                      { name: 'github-profile', desc: lang === 'zh' ? '3天前' : '3d ago' },
                      { name: 'MAI-Thinking', desc: lang === 'zh' ? '5天前' : '5d ago' },
                      { name: 'Open-Agent-in-Browser', desc: lang === 'zh' ? '1周前' : '1w ago' },
                      { name: 'blog-source', desc: lang === 'zh' ? '1周前' : '1w ago' },
                      { name: 'MiniCode', desc: lang === 'zh' ? '2周前' : '2w ago' }
                    ].map((item, idx) => (
                      <button 
                        key={idx}
                        onClick={() => {
                          setViewMode('chat');
                          setActiveTab('main');
                          setSimActiveSession(item.name);
                          triggerToast(lang === 'zh' ? `已切换本地工程上下文至: ${item.name}` : `Switched workspace mapping: ${item.name}`);
                        }}
                        className={`w-full flex items-center justify-between p-1 px-1.5 rounded text-left transition-colors ${viewMode === 'chat' && simActiveSession === item.name ? 'bg-white border-l-2 border-[#b87351] pl-2 font-bold shrink-0' : 'hover:bg-white/30'}`}
                      >
                        <div className="flex items-center gap-1.5 truncate max-w-[110px]">
                          <Folder size={11} className="text-yellow-600/70 shrink-0" />
                          <span className="truncate text-[10px]">{item.name}</span>
                        </div>
                        <span className="text-[8px] text-brand-text-muted shrink-0">
                          {idx === 0 ? (lang === 'zh' ? '刚刚' : 'now') : idx === 1 ? '10m' : item.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom sidebar Settings switch button */}
              <div className="pt-2 border-t border-brand-border/20">
                <button 
                  onClick={() => {
                    setViewMode('settings');
                    setCurrentSettingsTab('permissions');
                    triggerToast(lang === 'zh' ? '已进入本地环境拦截设置中心。' : 'Entered offline policies settings center.');
                  }}
                  className={`w-full flex items-center justify-between text-xs font-mono p-1.5 rounded-lg hover:bg-white/40 transition-colors text-left ${viewMode === 'settings' ? 'text-[#b87351] font-bold bg-white/50' : ''}`}
                >
                  <span className="flex items-center gap-1.5">
                    <Settings size={12} className="text-[#b87351]" />
                    <span>⚙️ {lang === 'zh' ? '安全设置' : 'Security Settings'}</span>
                  </span>
                  <span className="text-[8px] opacity-75">Tauri 2</span>
                </button>
              </div>
            </div>

            {/* RENDER MODE A: CHAT/SESSION VIEWER SCREEN */}
            {viewMode === 'chat' && (
              <div className="flex-1 flex flex-col justify-between relative bg-[#FAF9F5]/40" id="chat-workspace-viewport">
                
                {/* Clean, high-fidelity window center header precisely matching user screenshot */}
                <div className={`px-4 py-3 border-b flex items-center justify-between select-none bg-[#FAF9F5] border-[#dfd4bd]/60 shadow-[0_1px_2px_rgba(0,0,0,0.02)]`}>
                  {/* macOS close, minimize, expand buttons mock styling on left */}
                  <div className="hidden sm:flex items-center gap-1.5 w-1/4">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400 opacity-80"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 opacity-80"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-green-400 opacity-80"></span>
                    <span className="text-[10px] font-mono text-[#8c8072] ml-1">{simActiveSession}</span>
                  </div>

                  {/* Centered active session metadata */}
                  <div className="text-center flex-1">
                    <h4 className="text-xs font-bold text-[#2c2724] font-sans tracking-tight">
                      Clone Personal AI Infrastructure repo
                    </h4>
                    <p className="text-[9.5px] text-[#867e76] font-sans tracking-wide mt-0.5">
                      {lang === 'zh' ? '· 最后更新 2分钟前 · 810 条消息' : '· Last updated 2 mins ago · 810 messages'}
                    </p>
                  </div>
                  
                  {/* Action elements on right side */}
                  <div className="text-right w-1/4 hidden sm:flex items-center justify-end gap-2 text-[10px] font-mono text-[#8c8072]">
                    <span className="h-2 w-2 rounded-full bg-brand-success text-[8px]"></span>
                    <span>Tauri IPC Connected</span>
                  </div>
                </div>

                {/* Chats view log layout */}
                <div ref={chatContainerRef} className="flex-1 p-4 md:p-6 overflow-y-auto space-y-3 max-h-[380px] min-h-[320px] bg-transparent">
                  {simMessages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} w-full`}>
                      
                      {/* Name tags (only shown for special states and system logs, to keep clean screenshot lines elsewhere) */}
                      {msg.sender === 'system-error' && (
                        <div className="text-[9px] font-mono text-[#8c8072] mb-0.5 px-1 flex items-center gap-1 leading-none select-none">
                          <AlertTriangle size={9} className="text-amber-600" />
                          <span>Tauri Core Sandbox Security Intercepter</span>
                        </div>
                      )}

                      {/* High-Fidelity Bubble formatting reflecting screenshot */}
                      {msg.sender === 'user' ? (
                        <div className="max-w-[85%] bg-white border border-[#dfd6c2] rounded-xl px-4 py-2.5 text-xs text-[#2c2724] font-sans shadow-[0_1px_2px_rgba(0,0,0,0.02)] leading-relaxed select-text font-medium">
                          {msg.text}
                        </div>
                      ) : msg.sender === 'thought' ? (
                        <div className="text-[10.5px] text-[#84776e] font-mono py-1 select-text h-auto leading-relaxed italic border-l-2 border-[#b87351]/30 pl-2.5 my-1.5 max-w-[92%]">
                          {msg.text.startsWith('思考中') || msg.text.startsWith('thinking') ? `> ${msg.text}` : `> ${lang === 'zh' ? '思考中' : 'thinking'} ${msg.text}`}
                        </div>
                      ) : msg.sender === 'system-error' ? (
                        <div className="max-w-[90%] bg-amber-500/5 border border-amber-500/20 text-error rounded-xl p-3 text-[11px] font-mono leading-relaxed shadow-4xs">
                          {msg.text}
                        </div>
                      ) : msg.sender === 'tool' ? (
                        /* Beautiful tool call block exactly matching screenshot lines layout */
                        <div className="w-full max-w-full md:max-w-[92%] bg-white border border-[#dfd6c2] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] my-1.5 hover:border-brand-caramel/40 transition-colors">
                          <div 
                            onClick={() => toggleToolOpen(msg.id)}
                            className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="bg-[#2f2b28] text-[#faf9f6]/95 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-2xs shrink-0 select-none">
                                <span className="text-[#a89d91] font-normal">&gt;_</span>
                                Bash
                              </div>
                              <code className="text-[10.5px] font-mono text-[#3e342f] truncate select-all px-1 bg-[#ede4d4]/20 rounded font-medium">
                                {msg.commandCode}
                              </code>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-[#8c8072] ml-2 select-none">
                              <span>{msg.isOpen ? (lang === 'zh' ? '收起输出' : 'Collapse Output') : (lang === 'zh' ? '展开输出' : 'Expand Output')}</span>
                              <ChevronDown size={12} className={`transition-transform duration-200 ${msg.isOpen ? 'rotate-180' : ''}`} />
                            </div>
                          </div>
                          
                          {msg.isOpen && (
                            <div className="p-3 bg-[#1e1e1e] border-t border-[#dfd6c2]/60 text-[#ffdca1] font-mono text-[9.5px] whitespace-pre overflow-x-auto leading-relaxed shadow-inner font-light select-all">
                              {msg.commandStdout}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Standard Assistant output, supporting markdown lists and action widgets */
                        <div className="max-w-[85%] bg-white border border-[#dfd6c2] rounded-xl p-3.5 text-xs leading-relaxed text-[#2c2724] shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-2">
                          <div className="select-text font-serif text-[12.5px] text-[#2c2724] whitespace-pre-wrap">{msg.text}</div>
                          
                          {/* File list renderer for the final clean output block */}
                          {msg.filesList && (
                            <div className="mt-2.5 space-y-1.5 text-[11px] font-mono text-[#554f4b] pl-1">
                              {msg.filesList.map((f: any, idx: number) => (
                                <div key={idx} className="flex items-start gap-2 leading-relaxed">
                                  <span className="text-[#b87351] font-bold select-none">•</span>
                                  <div className="flex-1">
                                    <code className="bg-[#ede9e1] text-[#3e342f] text-[9.5px] px-1.5 py-0.5 rounded border border-[#dfd6c2] font-semibold mr-1.5 font-mono select-all">
                                      {f.name}
                                    </code>
                                    <span className="text-neutral-500 font-sans">- {f.desc}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Action pills widget bar under assistant card */}
                          {msg.actionButtons && (
                            <div className="mt-3 pt-2.5 border-t border-[#dfd6c2]/50 flex items-center gap-1.5 font-mono text-[10px] select-none text-[#867e76]">
                              <button 
                                onClick={() => {
                                  navigator?.clipboard?.writeText(msg.text || '');
                                  triggerToast(lang === 'zh' ? '📋 内容已成功复制至剪贴板！' : '📋 Content copied to clipboard!');
                                }}
                                className="px-2.5 py-1 bg-white hover:bg-[#faf9f6]/40 border border-[#dfd6c2] text-[#554f4b] rounded flex items-center gap-1 shadow-4xs transition-colors cursor-pointer"
                              >
                                <Copy size={11} className="text-[#a69888]" />
                                <span>Copy</span>
                              </button>
                              
                              <button 
                                onClick={() => triggerToast(lang === 'zh' ? '🌿 正在通过 AST 图解析当前节点分支状态...' : '🌿 Resolving active workspace node branches via AST...')}
                                className="px-2.5 py-1 bg-white hover:bg-[#faf9f6]/40 border border-[#dfd6c2] text-[#554f4b] rounded flex items-center gap-1 shadow-4xs transition-colors cursor-pointer"
                              >
                                <Network size={11} className="text-[#a69888]" />
                                <span>Fork Node</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {isTyping && (
                    <div className="text-[10px] text-[#867e76] font-mono flex items-center gap-2 italic animate-pulse py-1">
                      <RefreshCw size={11} className="animate-spin text-[#b87351]" />
                      <span>{lang === 'zh' ? '正在规划本地终端命令并审查系统资源...' : 'Planning local terminal commands and auditing system resources...'}</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Floating "回到最新" anchor buttons wrapper exactly matching user flow */}
                <button 
                  onClick={() => {
                    if (chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                    triggerToast(lang === 'zh' ? '已对齐到底部最新命令记录。' : 'Aligned to the latest terminal logs.');
                  }}
                  className="absolute bottom-24 right-5 bg-white border border-[#dfd6c2] font-mono text-[10.5px] text-[#554f4b] px-3.5 py-1.5 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex items-center gap-1.5 hover:bg-[#faf9f6] hover:text-[#b87351] transition-all select-none hover:scale-102 active:scale-98 cursor-pointer z-10 font-bold"
                >
                  <ChevronDown size={12} className="text-[#b87351] animate-bounce" />
                  <span>{lang === 'zh' ? '回到最新' : 'Scroll Latest'}</span>
                </button>

                {/* Simulated CLI Footer containing screenshot floating cards input bar */}
                <div className="p-3 bg-[#FAF9F5] border-t border-[#dfd4bd]/60 select-none font-sans">
                  
                  {/* High Fidelity floating terminal box bar wrapper */}
                  <form onSubmit={handleSendMessage} className="space-y-2">
                    
                    {/* The prominent double card row styling from user screenshot */}
                    <div className="bg-white border border-[#dfd6c2] rounded-xl p-2 shadow-[0_2px_6px_rgba(0,0,0,0.03)] space-y-2 flex flex-col justify-between font-sans">
                      {/* Input line */}
                      <input 
                        type="text" 
                        value={inputVal}
                        onChange={(e) => setInputVal(e.target.value)}
                        placeholder={lang === 'zh' ? '让 Claude 编辑、调试或解释代码...' : 'Ask Claude to edit, debug or explain code...'}
                        className="w-full px-2.5 py-1.5 text-xs border-0 focus:outline-hidden text-[#2c2724] placeholder-[#a69c91] font-sans"
                      />

                      {/* Tool bar inside the textcard */}
                      <div className="flex flex-wrap items-center justify-between border-t border-gray-100 pt-1.5 px-1 gap-2 font-sans">
                        {/* Left corner: "+" selector and Bypass indicator */}
                        <div className="flex items-center gap-1.5">
                          <button 
                            type="button" 
                            onClick={() => triggerToast(lang === 'zh' ? '📦 重构助手：已暂存 116 个编译外设' : '📦 Refactor Assist: Buffered 116 compiler peripherals')}
                            className="h-6 w-6 bg-[#efe8de] hover:bg-brand-border/40 text-neutral-700 rounded-full flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                          >
                            +
                          </button>

                          <div className="relative">
                            <select 
                              value={permissionMode}
                              onChange={(e) => {
                                setPermissionMode(e.target.value as any);
                                triggerToast(lang === 'zh'
                                  ? `已将端侧执行许可模式设为: ${e.target.value === 'skip-all' ? '自主跳过' : e.target.value === 'ask' ? '逐项询问' : '只读分析规划'}`
                                  : `Privilege authorization mode set to: ${e.target.value.toUpperCase()}`);
                              }}
                              className="appearance-none bg-[#efe8de] pl-2.5 pr-6 py-0.5 text-[10px] font-mono rounded-md hover:bg-brand-border/30 text-[#4f4944] border-0 outline-hidden font-bold cursor-pointer font-bold"
                            >
                              <option value="skip-all">{lang === 'zh' ? '跳过' : 'Bypass'}</option>
                              <option value="ask">{lang === 'zh' ? '询问' : 'Ask'}</option>
                              <option value="plan-only">{lang === 'zh' ? '规划' : 'Plan'}</option>
                            </select>
                            <span className="absolute right-2 top-2 pointer-events-none text-[8px] text-[#867e76] font-mono leading-none font-bold">▼</span>
                          </div>
                        </div>

                        {/* Right corner: loading ring, model choice and Run submit button */}
                        <div className="flex items-center gap-1.5 font-mono">
                          {/* real-time progress simulation component */}
                          <div 
                            className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 text-neutral-100 px-2 py-0.5 rounded-full text-[9px] cursor-pointer"
                            onClick={() => triggerToast(lang === 'zh' ? '🌟 端侧运行时能耗指数：26% • 极度绿环保级' : '🌟 Desktop runtime energy load: 26% • Eco Eco-Green Approved')}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-ping"></span>
                            <span>26%</span>
                          </div>

                          {/* Model dropdown container */}
                          <div className="relative">
                            <select 
                              className="appearance-none text-[10px] font-mono font-bold pl-2 pr-5 py-0.5 bg-neutral-100 rounded-md text-[#554f4b] hover:bg-neutral-200 outline-hidden border-0 cursor-pointer"
                              onChange={(e) => triggerToast(lang === 'zh'
                                ? `已重设主干对话编译器内核: ${e.target.value === 'glm' ? 'GLM-5.1' : e.target.value === 'claude' ? 'Claude 3.5' : 'DeepSeek'}`
                                : `Compiler workspace backend rechanneled to: ${e.target.value === 'glm' ? 'GLM-5.1 Official' : e.target.value === 'claude' ? 'Claude 3.5 Sonnet' : 'DeepSeek R1 Offline'}`)}
                            >
                              <option value="glm">GLM-5.1 {lang === 'zh' ? 'DreamField 官方' : 'DreamField Official'}</option>
                              <option value="claude">Claude 3.5 Sonnet {lang === 'zh' ? '官方' : 'Official'}</option>
                              <option value="deepseek">DeepSeek Code R1 {lang === 'zh' ? '本地端' : 'Local Node'}</option>
                            </select>
                            <span className="absolute right-2 top-2.5 pointer-events-none text-[7px] text-[#8c8072]">▼</span>
                          </div>

                          {/* Large Action click handler */}
                          <button 
                            type="submit" 
                            className="bg-[#b87351] text-[#faf9f6]/95 hover:bg-[#a65f3d] rounded-lg px-3 py-1 text-[11px] font-bold transition-all duration-150 flex items-center gap-1 cursor-pointer active:scale-95 shrink-0 shadow-2xs"
                          >
                            <span>{lang === 'zh' ? '运行' : 'Run'}</span>
                            <span>→</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Path metadata line precisely matched from user details */}
                    <div className="flex items-center justify-between text-[9px] font-mono text-[#8c8072] px-1 select-none">
                      <div className="flex items-center gap-1">
                        <Folder size={11} className="text-[#a69a84]" />
                        <span className="font-semibold text-neutral-700">E:\AProject\TianX\Personal\PAI_dev</span>
                        <span className="text-gray-300 font-normal">|</span>
                        <span className="text-neutral-500 font-bold">master</span>
                      </div>
                      <span>{lang === 'zh' ? '离线沙箱安全挂载层已放行一切 Stdio 双向链路' : 'Offline secure sandbox authorized all duplex stdio channels'}</span>
                    </div>

                  </form>
                </div>
              </div>
            )}

            {/* RENDER MODE B: SETTINGS PANEL DUAL LAYOUT (Middle sub-navigation & Right specific screen) */}
            {viewMode === 'settings' && (
              <div className="flex-1 flex flex-col md:flex-row transition-all duration-200">
                
                {/* MIDDLE COLUMN: Settings Sub-navigation (Exactly like Screenshots) */}
                <div className={`w-full md:w-[130px] border-r flex flex-col justify-between p-2 select-none shrink-0 transition-colors ${currentTheme.innerNav}`}>
                  <div className="space-y-3">
                    <div className="text-[9px] font-bold text-brand-text-muted uppercase tracking-wider px-1.5 py-1 font-mono">
                      {lang === 'zh' ? '设置分类' : 'Settings Category'}
                    </div>
                    
                    <nav className="space-y-0.5 text-xs font-mono">
                      {[
                        { id: 'provider', label: lang === 'zh' ? '服务商' : 'Providers', badge: 'API' },
                        { id: 'permissions', label: lang === 'zh' ? '权限控制' : 'Permissions', badge: '🛡️' },
                        { id: 'general', label: lang === 'zh' ? '通用主题' : 'Themes UI', badge: '⚙️' },
                        { id: 'skills', label: lang === 'zh' ? '技能浏览器' : 'Skills DB', badge: '📜' },
                        { id: 'plugins', label: lang === 'zh' ? '插件中心' : 'Plugins', badge: '🔌' },
                        { id: 'computer', label: 'Computer Use', badge: '🤖' },
                        { id: 'token', label: lang === 'zh' ? 'Token 用量' : 'Token Usage', badge: '🔥' }
                      ].map((item) => (
                        <button 
                          key={item.id}
                          onClick={() => {
                            setCurrentSettingsTab(item.id);
                            triggerToast(lang === 'zh' 
                              ? `已切换至「${item.label}」设置中继控制。` 
                              : `Switched to ${item.label} pane.`);
                          }}
                          className={`w-full text-left p-1.5 px-2 rounded-md transition-colors font-medium flex items-center justify-between ${currentSettingsTab === item.id ? 'bg-white text-brand-caramel font-bold border-l-2 border-brand-caramel pl-2.5' : 'hover:bg-white/30 text-brand-text-title'}`}
                        >
                          <span>{item.label}</span>
                          <span className="text-[9px] opacity-75">{item.badge}</span>
                        </button>
                      ))}
                    </nav>
                  </div>

                  {/* About dialog trigger at bottom of middle sub menu */}
                  <div className="pt-2 border-t border-brand-border/20 text-center">
                    <button 
                      onClick={() => alert(lang === 'zh'
                        ? 'DreamCoder (Claude Code 跨平台图形化客户端)\n版本: 0.3.0\n端侧底座: Tauri 2.0.4 + Bun 1.1\n视觉设计: Terracotta 陶土自然韵律\nMIT 协议开源许可项目。'
                        : 'DreamCoder (Claude Code Graphical Client)\nVersion: 0.3.0\nTauri Base Framework: Tauri 2.0.4 + Bun 1.1\nVisual Scheme: Terracotta Earth-tone Accent\nMIT Open Source Worksite.')}
                      className="text-[9px] font-mono hover:text-brand-caramel hover:underline text-brand-text-muted flex items-center gap-1 justify-center mx-auto cursor-pointer"
                    >
                      <Info size={10} />
                      <span>{lang === 'zh' ? '关于 DreamCoder' : 'About DreamCoder'}</span>
                    </button>
                  </div>
                </div>

                {/* RIGHT COLUMN: Actual settings parameters according to the selected tab */}
                <div className="flex-1 p-4 md:p-5 overflow-y-auto max-h-[460px] bg-white text-[#2c2724] relative">
                  
                  {/* TAB 1: PROVIDERS SETTING (setting_provider.png style) */}
                  {currentSettingsTab === 'provider' && (
                    <div className="space-y-4 animate-fade-in font-sans">
                      <div className="flex items-center justify-between pb-2 border-b border-brand-border/40">
                        <div>
                          <h4 className="text-base font-bold text-brand-text-title">
                            {lang === 'zh' ? '服务商连接凭证' : 'Provider Endpoints & Keys'}
                          </h4>
                          <p className="text-[11px] text-brand-text-muted mt-0.5">
                            {lang === 'zh' ? '私有端侧链路映射中心，所有密钥硬件加密保存在系统特权 Keychain。' : 'Private offline credential registry. All tokens are securely sealed under OS system Keychain.'}
                          </p>
                        </div>
                        <button 
                          onClick={() => setIsAddingProv(true)}
                          className="px-2.5 py-1 bg-[#b87351] text-white hover:bg-brand-caramel/90 font-mono text-[10px] font-bold rounded cursor-pointer"
                        >
                          {lang === 'zh' ? '+ 添加服务商' : '+ Add Provider'}
                        </button>
                      </div>

                      {/* Add Provider Panel */}
                      {isAddingProv && (
                        <form onSubmit={addCustomProvider} className="p-3 bg-brand-bg-primary/40 border border-[#b87351]/30 rounded-lg space-y-2 text-xs font-mono">
                          <div className="flex justify-between items-center text-[10px] font-bold">
                            <span>{lang === 'zh' ? '添加全新模型提供商 (BaseURL + SecretKey)' : 'Register Custom LLM Interface (BaseURL + SecretKey)'}</span>
                            <button type="button" onClick={() => setIsAddingProv(false)} className="text-red-600 font-bold cursor-pointer">{lang === 'zh' ? '取消' : 'Cancel'}</button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input 
                              type="text" 
                              required 
                              value={newProvName}
                              onChange={(e) => setNewProvName(e.target.value)}
                              placeholder={lang === 'zh' ? '供应商名称: 如 DeepSeek' : 'Provider ID: e.g. DeepSeek'} 
                              className="p-1 px-2 border border-brand-border bg-white rounded text-xs" 
                            />
                            <input 
                              type="text" 
                              required 
                              value={newProvUrl}
                              onChange={(e) => setNewProvUrl(e.target.value)}
                              placeholder="BaseURL: https://api.deepseek.com" 
                              className="p-1 px-2 border border-brand-border bg-white rounded text-xs" 
                            />
                          </div>
                          <button type="submit" className="w-full py-1 bg-[#b87351] text-white font-mono text-xs rounded font-bold cursor-pointer">
                            {lang === 'zh' ? '绑定至本地链' : 'Bind to Endpoint Chain'}
                          </button>
                        </form>
                      )}

                      {/* Providers lists rendering */}
                      <div className="space-y-2.5">
                        {simProviders.map(p => (
                          <div key={p.id} className={`p-3 border rounded-xl font-mono text-xs ${p.isDefault ? 'border-[#b87351] bg-[#efe8de]/10' : 'border-brand-border hover:bg-gray-50'}`}>
                            <div className="flex justify-between items-center">
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-brand-success animate-pulse"></span>
                                  <span className="font-bold text-brand-text-title">{p.name}</span>
                                  {p.isDefault && (
                                    <span className="px-1.5 py-0.2 rounded bg-[#b87351]/10 text-[#b87351] text-[8px] font-bold">
                                      {lang === 'zh' ? '默认首选' : 'Primary Route'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-brand-text-muted truncate max-w-[280px]">BaseURL: {p.url}</div>
                                <div className="text-[10px] text-brand-text-muted">
                                  {lang === 'zh' ? '路由主模型: ' : 'Primary Target Model: '}
                                  <span className="text-brand-caramel font-bold">{p.model}</span>
                                </div>
                              </div>
                              <div className="flex gap-1 select-none">
                                <button 
                                  onClick={() => {
                                    setSimProviders(prev => prev.map(item => ({ ...item, isDefault: item.id === p.id })));
                                    triggerToast(lang === 'zh' ? `已设置首选模组供应商为: ${p.name}` : `Selected default pipeline route: ${p.name}`);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer font-medium ${p.isDefault ? 'bg-[#b87351]/20 text-[#b87351] font-bold' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`}
                                >
                                  {lang === 'zh' ? '设为默认' : 'Set Default'}
                                </button>
                                <button 
                                  onClick={() => {
                                    if (p.isDefault) {
                                      alert(lang === 'zh' ? '不能删除当前首选线路' : 'Primary active route cannot be unregistered');
                                      return;
                                    }
                                    setSimProviders(prev => prev.filter(item => item.id !== p.id));
                                    triggerToast(lang === 'zh' ? '服务线路已注销！' : 'Endpoint connection discarded!');
                                  }}
                                  className="p-1 border text-red-600 border-gray-200 rounded hover:bg-red-50 cursor-pointer"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: PERMISSIONS SETTINGS (Screenshot 1) */}
                  {currentSettingsTab === 'permissions' && (
                    <div className="space-y-5 animate-fade-in font-sans" id="settings-view-permissions">
                      <div className="pb-2 border-b border-brand-border/40">
                        <h4 className="text-base font-bold text-brand-text-title">
                          {lang === 'zh' ? '权限与工具审批' : 'Security Permission Levels'}
                        </h4>
                        <p className="text-[11px] text-brand-text-muted mt-0.5">
                          {lang === 'zh' ? '控制本地工具链执行权限的处理方式。开启智能拦截，放行受信任指令。' : 'Control permission levels for client-side tool execution. Block suspicious system routines dynamically.'}
                        </p>
                      </div>

                      {/* Options cards list matching Screenshot 1 exactly */}
                      <div className="grid grid-cols-1 gap-3 font-mono">
                        
                        {/* Option 1: Ask Permissions */}
                        <div 
                          onClick={() => {
                            setPermissionMode('ask');
                            triggerToast(lang === 'zh' ? '已设为 [询问权限] 模式。每次 Shell 脚本写入均会引发视窗挂载询问。' : 'Switched to [Ask authorization] mode for tools.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${permissionMode === 'ask' ? 'bg-white border-[#b87351] ring-1 ring-[#b87351]/20' : 'bg-gray-50 border-brand-border hover:bg-gray-100/70'}`}
                        >
                          <Shield className="text-blue-600 mt-1 shrink-0" size={16} />
                          <div className="space-y-0.5">
                            <div className="font-bold text-xs text-brand-text-title flex items-center gap-1.5">
                              <span>{lang === 'zh' ? '询问权限' : 'Ask Permission'}</span>
                              <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.2 rounded">
                                {lang === 'zh' ? '标准隔离' : 'Standard Isolated'}
                              </span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '工具回调前先前置拦截并发出弹窗询问。保障系统极高安全性，防范有害二进制脚本执行。' : 'Interrupt actions prior to execution to trigger popup warnings. Secures local directory loops.'}
                            </p>
                          </div>
                          <div className="ml-auto mt-1 select-none">
                            <span className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${permissionMode === 'ask' ? 'border-[#b87351] bg-[#b87351] text-white' : 'border-gray-300'}`}>
                              {permissionMode === 'ask' && <Check size={10} />}
                            </span>
                          </div>
                        </div>

                        {/* Option 2: Accept File Edits only */}
                        <div 
                          onClick={() => {
                            setPermissionMode('accept-edit');
                            triggerToast(lang === 'zh' ? '已设为 [自动文件编辑] 模式。AI 对代码段覆写时无需再手动回车确认。' : 'Accept local text file changes automatically.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${permissionMode === 'accept-edit' ? 'bg-white border-[#b87351] ring-1 ring-[#b87351]/20' : 'bg-gray-50 border-brand-border hover:bg-gray-100/70'}`}
                        >
                          <FileCode className="text-indigo-600 mt-1 shrink-0" size={16} />
                          <div className="space-y-0.5">
                            <div className="font-bold text-xs text-brand-text-title flex items-center gap-1.5">
                              <span>{lang === 'zh' ? '接受文件编辑' : 'Auto File Edits'}</span>
                              <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.2 rounded">
                                {lang === 'zh' ? '代码信任' : 'Asset Trust'}
                              </span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '自动批准代码层级编辑。AI 写代码一路绿灯，但涉及原生 Shell 命令提升时仍需人工。' : 'Accept normal typescript edits directly, while keeping interactive constraints on risky bash scripts.'}
                            </p>
                          </div>
                          <div className="ml-auto mt-1 select-none">
                            <span className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${permissionMode === 'accept-edit' ? 'border-[#b87351] bg-[#b87351] text-white' : 'border-gray-300'}`}>
                              {permissionMode === 'accept-edit' && <Check size={10} />}
                            </span>
                          </div>
                        </div>

                        {/* Option 3: Planning mode only */}
                        <div 
                          onClick={() => {
                            setPermissionMode('plan-only');
                            triggerToast(lang === 'zh' ? '已调整至 [计划模式]。AI 将只吐出思考日志与方案路线，绝对不执行写入。' : 'Authorized dry-run blueprint simulation planning only.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${permissionMode === 'plan-only' ? 'bg-white border-[#b87351] ring-1 ring-[#b87351]/20' : 'bg-gray-50 border-brand-border hover:bg-gray-100/70'}`}
                        >
                          <Sliders className="text-[#b87351] mt-1 shrink-0" size={16} />
                          <div className="space-y-0.5">
                            <div className="font-bold text-xs text-brand-text-title flex items-center gap-1.5">
                              <span>{lang === 'zh' ? '计划模式 (Dry-run Plan)' : 'Plan Only (Dry-run)'}</span>
                              <span className="text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.2 rounded">
                                {lang === 'zh' ? '只读模拟' : 'ReadOnly Sandbox'}
                              </span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '仅思考和规划路线，不向磁盘写入字节。适合核心中台重构前进行影响范围分析。' : 'Simulate thought vectors and code proposals strictly without touching storage assets.'}
                            </p>
                          </div>
                          <div className="ml-auto mt-1 select-none">
                            <span className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${permissionMode === 'plan-only' ? 'border-[#b87351] bg-[#b87351] text-white' : 'border-gray-300'}`}>
                              {permissionMode === 'plan-only' && <Check size={10} />}
                            </span>
                          </div>
                        </div>

                        {/* Option 4: Skip All validations (screenshot checked active!) */}
                        <div 
                          onClick={() => {
                            setPermissionMode('skip-all');
                            triggerToast(lang === 'zh' ? '⚠️ [警告] 您当前解锁了「跳过全部」模式。AI 拥有最高端侧宿主特权。' : '⚠️ Danger: Auto-execution mode unlocked. Agent is granted raw shell privileges.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${permissionMode === 'skip-all' ? 'bg-[#ff9500]/5 border-[#ff9500] ring-1 ring-[#ff9500]/10' : 'bg-gray-50 border-brand-border hover:bg-gray-100/70'}`}
                        >
                          <Zap className="text-amber-500 mt-1 shrink-0 animate-bounce" size={16} />
                          <div className="space-y-0.5">
                            <div className="font-bold text-xs text-[#b87351] flex items-center gap-1.5">
                              <span>{lang === 'zh' ? '自动执行 (极速自主回调)' : 'Skip Approvals (High Speed)'}</span>
                              <span className="text-[9px] bg-red-100 text-red-700 font-bold px-1.5 py-0.2 rounded">
                                {lang === 'zh' ? '特权开放' : 'High Privilege'}
                              </span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '跳过所有人工确认提问。Agent 毫秒级自主写盘并运行测试脚本，开发吞吐效率全网最高。' : 'Approve all text and command hooks seamlessly. Ensures fastest dev compilation stream.'}
                            </p>
                          </div>
                          <div className="ml-auto mt-1 select-none">
                            <span className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${permissionMode === 'skip-all' ? 'border-[#ff9500] bg-[#ff9500] text-white font-bold' : 'border-gray-300'}`}>
                              {permissionMode === 'skip-all' && <Check size={10} />}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Security tip box */}
                      <div className="p-3 bg-gray-50 border border-brand-border/60 rounded-xl flex gap-2 font-mono text-[10.5px] leading-relaxed text-brand-text-muted">
                        <InfoIcon size={14} className="text-[#b87351] shrink-0 mt-0.5" />
                        <div>
                          <strong>{lang === 'zh' ? '🛡️ 端侧沙盒安全保证：' : '🛡️ Secure Local Sandbox Defense:'}</strong>
                          {lang === 'zh' 
                            ? '本客户端独立运行。底层会经过黑名单过滤器的物理级哨兵拦截。即使开启特权放行，高风险行为（如 rm -rf /）仍会被坚决掐断。'
                            : 'Executed locally. Lower client runtime pipelines are securely audited against commands blacklist (like rm -rf). Dangerous behaviors will be blocked.'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: GENERAL SETTINGS & INTERACTIVE COLOR SWITCH (Screenshot 2) */}
                  {currentSettingsTab === 'general' && (
                    <div className="space-y-4 animate-fade-in font-sans" id="settings-view-general">
                      <div className="pb-2 border-b border-brand-border/40">
                        <h4 className="text-base font-bold text-brand-text-title">
                          {lang === 'zh' ? '系统偏好与配置' : 'Preferences & Themes'}
                        </h4>
                        <p className="text-[11px] text-brand-text-muted mt-0.5">
                          {lang === 'zh' ? '调控客户端的基本交互反馈，配色主题支持一键实时重绘沙盘！' : 'Aesthetic presets and runtime switches, supporting live coloring of the simulator sandbox.'}
                        </p>
                      </div>

                      <div className="space-y-4 font-mono text-xs">
                        
                        {/* Interactive UI Theme Switch (Screenshot 2 style) */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-brand-text-muted uppercase block">
                            {lang === 'zh' ? '🎨 配色主题' : '🎨 Aesthetic Skins'}
                          </label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {[
                              { id: 'warm', label: lang === 'zh' ? '经典暖色' : 'Terracotta Warm', color: 'bg-[#faf9f6] text-[#2c2724] border-brand-border' },
                              { id: 'light', label: lang === 'zh' ? '纯白空间' : 'Canvas Pristine', color: 'bg-white text-gray-800 border-gray-300' },
                              { id: 'dark', label: lang === 'zh' ? '深邃高灰' : 'Graphite Dark', color: 'bg-[#1e1e1e] text-gray-200 border-gray-700' },
                              { id: 'midnight', label: lang === 'zh' ? '星域午夜' : 'Space Midnight', color: 'bg-[#0f111a] text-blue-100 border-[#1b2234]' },
                              { id: 'emerald', label: lang === 'zh' ? '翡翠青绿' : 'Emerald Forest', color: 'bg-[#0b1b17] text-emerald-100 border-emerald-800' },
                              { id: 'amber', label: lang === 'zh' ? '秋日琥珀' : 'Golden Harvest', color: 'bg-[#170e06] text-amber-200 border-amber-800' }
                            ].map(theme => (
                              <button 
                                key={theme.id}
                                type="button"
                                onClick={() => {
                                  setSimulatorTheme(theme.id as SimTheme);
                                  triggerToast(lang === 'zh' 
                                    ? `已全局渲染应用：${theme.label} 预制主题！` 
                                    : `Rendered aesthetic scheme: ${theme.label}`);
                                }}
                                className={`p-2 rounded-lg border text-left transition-all relative flex flex-col justify-between cursor-pointer ${theme.color} ${simulatorTheme === theme.id ? 'ring-2 ring-brand-caramel font-bold' : 'hover:scale-[1.01]'}`}
                              >
                                <span>{theme.label}</span>
                                {simulatorTheme === theme.id && (
                                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-brand-caramel"></span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Interactive Language and other items */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                          
                          {/* App Display Language Row */}
                          <div className="space-y-1.5 animate-pulse">
                            <label className="text-[10px] font-bold text-[#b87351] block uppercase">
                              {lang === 'zh' ? '🌐 语言切换 (GLOBAL LANGUAGE)' : '🌐 App Language Selection'}
                            </label>
                            <div className="flex gap-1.5">
                              {['中文', 'English'].map((langItem, lidx) => {
                                const active = (selectedLanguage === 'zh' && lidx === 0) || (selectedLanguage === 'en' && lidx === 1);
                                return (
                                  <button 
                                    key={langItem}
                                    type="button"
                                    onClick={() => {
                                      setSelectedLanguage(lidx === 0 ? 'zh' : 'en');
                                      setLang(lidx === 0 ? 'zh' : 'en'); // synchronize global application dictionary!
                                      triggerToast(lidx === 0 
                                        ? '已切换客户端 UI 字典：简体中文' 
                                        : 'Global application language set to English');
                                    }}
                                    className={`flex-1 py-1.5 border rounded-lg text-center font-bold cursor-pointer text-xs transition-all hover:scale-[1.02] ${active ? 'border-[#b87351] bg-[#efe8de]/35 text-[#b87351]' : 'border-gray-200 bg-white text-[#554f4b]'}`}
                                  >
                                    {langItem}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Reasoning Strength Select Buttons */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-brand-text-muted block">
                              {lang === 'zh' ? '⚡ 推理强度 (REASONING)' : '⚡ Reasoning Severity'}
                            </label>
                            <div className="flex bg-gray-50 p-0.5 border border-gray-200 rounded-lg select-none">
                              {[
                                { id: 'low', label: lang === 'zh' ? '低' : 'Low' },
                                { id: 'medium', label: lang === 'zh' ? '中' : 'Medium' },
                                { id: 'high', label: lang === 'zh' ? '高' : 'High' },
                                { id: 'max', label: lang === 'zh' ? '最大' : 'Max' }
                              ].map((item) => (
                                <button 
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setReasoningStrength(item.id as any);
                                    triggerToast(lang === 'zh' ? `模型推理限制级别设为: ${item.label}` : `Semantic reasoning cap levels set to: ${item.label}`);
                                  }}
                                  className={`flex-1 py-1 text-[11px] rounded transition-colors cursor-pointer ${reasoningStrength === item.id ? 'bg-white text-brand-caramel shadow-xs font-bold' : 'text-gray-500 hover:text-black'}`}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Response Language Select */}
                        <div className="space-y-1 bg-gray-50 p-2.5 border border-gray-200 rounded-xl">
                          <label className="text-[10px] font-bold text-brand-text-muted block">
                            {lang === 'zh' ? '✍️ 答复语言倾斜 (RESPONSE PREFERENCE)' : '✍️ Output Generation Preference'}
                          </label>
                          <select 
                            value={responseLanguage}
                            onChange={(e) => {
                              setResponseLanguage(e.target.value);
                              triggerToast(lang === 'zh' 
                                ? `已指定模型回复语言倾向为: ${e.target.value === 'default' ? '默认系统语言' : e.target.value === 'zh' ? '简体中文' : '繁体中文'}`
                                : `Primary semantic reply locale mapped: ${e.target.value.toUpperCase()}`);
                            }}
                            className="w-full mt-1 p-1 bg-white border border-gray-200 rounded text-xs select-none focus:outline-hidden cursor-pointer"
                          >
                            <option value="default">{lang === 'zh' ? '默认（跟随操作系统语言）' : 'Default (Inherit OS Locales)'}</option>
                            <option value="zh">简体中文 (Simplified Chinese)</option>
                            <option value="en">English (US)</option>
                            <option value="ja">日本語 (Japanese)</option>
                          </select>
                        </div>

                        {/* Switch for system notifications and thinking mode! */}
                        <div className="space-y-2 pt-2">
                          
                          {/* Thinking Mode Switch Card */}
                          <div className="p-3 bg-gray-50 border border-brand-border/40 rounded-xl flex items-start gap-2.5">
                            <input 
                              type="checkbox" 
                              id="thinking-chk"
                              checked={thinkingModeEnabled}
                              onChange={(e) => {
                                setThinkingModeEnabled(e.target.checked);
                                triggerToast(e.target.checked 
                                  ? (lang === 'zh' ? '已开启新会话思考策略（完美支持 DeepSeek-V3 思考流）。' : 'Enabled deep cognitive thinking outputs.') 
                                  : (lang === 'zh' ? '已关闭思考模式 (会话将显式附带 --thinking disabled 指示参数)。' : 'Disabled active thinking stream.'));
                              }}
                              className="mt-1 shrink-0 accent-orange-700 cursor-pointer"
                            />
                            <div className="space-y-0.5">
                              <label htmlFor="thinking-chk" className="font-bold text-brand-text-title block cursor-pointer select-none">
                                {lang === 'zh' ? '启用思考模式 (Cognitive Thinking)' : 'Enable Active Cognitive Thinking'}
                              </label>
                              <span className="text-[10px] text-brand-text-muted leading-relaxed block">
                                {lang === 'zh' 
                                  ? '开启后新会话将自动引发模型深度思考。特别适合 DeepSeek R1 / Claude 3.5 Sonnet 推理链。' 
                                  : 'Auto-inject reasoning budgets during query formulation. Perfect for deep-thinking architectures.'}
                              </span>
                            </div>
                          </div>

                          {/* Trigger Native Notification checkbox */}
                          <div className="p-3 bg-gray-50 border border-brand-border/40 rounded-xl flex items-start gap-2.5">
                            <input 
                              type="checkbox" 
                              id="notif-chk"
                              checked={systemNotificationsEnabled}
                              onChange={(e) => {
                                setSystemNotificationsEnabled(e.target.checked);
                                triggerToast(e.target.checked 
                                  ? (lang === 'zh' ? '已允许 DreamCoder 推送 Agent 异步通知。' : 'Allowed native operating system push feeds.') 
                                  : (lang === 'zh' ? '系统原生静默。' : 'Silent notification channel selected.'));
                              }}
                              className="mt-1 shrink-0 accent-orange-700 cursor-pointer"
                            />
                            <div className="space-y-0.5">
                              <label htmlFor="notif-chk" className="font-bold text-brand-text-title block cursor-pointer select-none">
                                {lang === 'zh' ? '启用系统通知 (OS Notifications)' : 'Allow Desktop OS Notifications'}
                              </label>
                              <span className="text-[10px] text-brand-text-muted leading-relaxed block col-span-12">
                                {lang === 'zh' 
                                  ? '允许 Agent 运行测试套件结束、拦截核心特权时，发出 OS 系统原生推窗。' 
                                  : 'Dispatch alerts when background testing loops complete or security sentinel blocks privileges.'}
                              </span>
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}

                  {/* TAB 4: SKILLS LIST (Screenshot 3 Style) */}
                  {currentSettingsTab === 'skills' && (
                    <div className="space-y-4 animate-fade-in font-sans" id="settings-view-skills">
                      <div className="pb-2 border-b border-brand-border/40">
                        <h4 className="text-base font-bold text-brand-text-title">
                          {lang === 'zh' ? '本地赋能技能 (Skills Manuals)' : 'Installed System Skills'}
                        </h4>
                        <p className="text-[11px] text-brand-text-muted mt-0.5">
                          {lang === 'zh' ? '技能会大幅度扩展 Claude 指令边界。您可以在本地 `~/.claude/skills/` 编写注入。' : 'Client skills extend Claude capability boundaries. They are safely tracked under ~/.claude/skills/ directory.'}
                        </p>
                      </div>

                      {/* Header overview metrics from Screenshot 3 */}
                      <div className="grid grid-cols-3 gap-2 text-center font-mono">
                        <div className="p-2 bg-gray-50 border border-brand-border/60 rounded-lg">
                          <span className="text-[9px] text-brand-text-muted uppercase block">{lang === 'zh' ? '技能总数' : 'Total Skills'}</span>
                          <span className="block text-base font-bold text-brand-caramel mt-0.2">116</span>
                        </div>
                        <div className="p-2 bg-gray-50 border border-brand-border/60 rounded-lg">
                          <span className="text-[9px] text-brand-text-muted uppercase block">{lang === 'zh' ? '来源分类' : 'Categories'}</span>
                          <span className="block text-base font-bold text-brand-success mt-0.2">
                            {lang === 'zh' ? '2 种' : '2 Sources'}
                          </span>
                        </div>
                        <div className="p-2 bg-gray-50 border border-[#b87351]/30 rounded-lg">
                          <span className="text-[9px] text-brand-text-muted uppercase block">{lang === 'zh' ? '编译 Weights' : 'Compiled Bytes'}</span>
                          <span className="block text-base font-bold text-[#b87351] mt-0.2">331,157</span>
                        </div>
                      </div>

                      <div className="flex flex-col lg:flex-row gap-3">
                        
                        {/* Skills Browser split list */}
                        <div className="flex-1 space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                          
                          {/* Search bar inside browser section */}
                          <div className="relative mb-2 shrink-0">
                            <input 
                              type="text" 
                              placeholder={lang === 'zh' ? '搜索技能名称或描述...' : 'Search manual keywords...'}
                              value={searchSkill}
                              onChange={(e) => setSearchSkill(e.target.value)}
                              className="w-full p-1.5 pl-6 bg-gray-50 border border-gray-300 rounded text-[11px] font-mono focus:outline-hidden"
                            />
                            <Search size={10} className="absolute left-2 top-2.5 text-brand-text-muted" />
                          </div>

                          {filteredSkills.map((skill) => (
                            <div 
                              key={skill.id}
                              onClick={() => {
                                setSelectedSkillDetail(skill.id);
                                triggerToast(lang === 'zh' ? `已检索技能：${skill.title}` : `Retrieved active skill module: ${skill.title}`);
                              }}
                              className={`p-2 rounded-lg border transition-all cursor-pointer text-xs font-monoAs ${selectedSkillDetail === skill.id ? 'bg-[#efe8de]/15 border-[#b87351] ring-1 ring-[#b87351]/20' : 'bg-gray-50 hover:bg-gray-100 border-gray-200'}`}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-bold flex items-center gap-1">
                                  <span className="h-1 w-1 rounded-full bg-brand-success"></span>
                                  <span>{skill.title}</span>
                                </span>
                                <span className="text-[8px] bg-white border border-brand-border px-1 py-0.2 rounded text-brand-text-muted">
                                  {skill.count}
                                </span>
                              </div>
                              <p className="text-[10px] text-brand-text-muted truncate leading-relaxed">{skill.desc}</p>
                            </div>
                          ))}
                        </div>

                        {/* Skill Explorer Right details panel */}
                        <div className="w-full lg:w-[170px] bg-gray-100 p-3 rounded-xl border border-gray-200 text-xs font-mono space-y-2.5 select-text shrink-0">
                          {(() => {
                            const detail = skillsList.find(sk => sk.id === selectedSkillDetail) || skillsList[0];
                            return (
                              <>
                                <div className="pb-1.5 border-b border-gray-200">
                                  <span className="text-[8px] uppercase tracking-wider text-brand-caramel font-bold">INFO DATA BLOCK</span>
                                  <h5 className="font-bold text-brand-text-title text-[13px] truncate">{detail.title}</h5>
                                </div>
                                
                                <div className="space-y-1.5 text-[10px] leading-relaxed">
                                  <div>
                                    <span className="text-brand-text-muted block">{lang === 'zh' ? '平均启动时长:' : 'Averaged Latency:'}</span>
                                    <span>{detail.id === 'autoresearch' ? '280ms' : detail.id === 'academic-slides' ? '12ms' : '40ms'}</span>
                                  </div>
                                  <div>
                                    <span className="text-brand-text-muted block">{lang === 'zh' ? '调用计量:' : 'Invocation Counter:'}</span>
                                    <span className="text-[#b87351] font-bold">{detail.views}</span>
                                  </div>
                                  <div>
                                    <span className="text-brand-text-muted block">{lang === 'zh' ? '扩展分类:' : 'Extended Source:'}</span>
                                    <strong>{detail.type === 'plugin' ? '🔌 MCP Plugin' : detail.type === 'user' ? '💻 User Cmd' : '⚡ Native'}</strong>
                                  </div>
                                </div>

                                <p className="text-[9px] text-gray-500 border-t border-gray-200/60 pt-1 leading-normal">
                                  {lang === 'zh' 
                                    ? '此为本地安装的安全技能。可在 ~/.claude/skills 编写 JSON 完成一键扩展布局。' 
                                    : 'Secured offline plugin hooks. You can author declarative profiles under ~/.claude/skills directories.'}
                                </p>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 5: PLUGINS LIST (Screenshot 4 Style) */}
                  {currentSettingsTab === 'plugins' && (
                    <div className="space-y-4 animate-fade-in font-sans" id="settings-view-plugins">
                      
                      {/* Sub Header */}
                      <div className="flex items-center justify-between pb-2 border-b border-brand-border/40">
                        <div>
                          <h4 className="text-base font-bold text-brand-text-title">
                            {lang === 'zh' ? '已安装核心插件' : 'Registered MCP Plugins'}
                          </h4>
                          <p className="text-[11px] text-brand-text-muted mt-0.5">
                            {lang === 'zh' ? '实时查看、启动或停用已安装插件，并一键载入至 Tauri 与 CLI 沙箱中。' : 'Inspect, enable or register plugins, hot-loading them into current development workspace.'}
                          </p>
                        </div>
                        <button 
                          onClick={handleApplyPluginChanges}
                          className="px-3.5 py-1 bg-[#ff9500] hover:bg-[#ff9500]/90 text-white font-mono text-xs font-bold rounded-lg transition-all shadow-2xs cursor-pointer select-none active:scale-95"
                        >
                          {lang === 'zh' ? '应用变更' : 'Apply Changes'}
                        </button>
                      </div>

                      {/* Overviews widgets from Screenshot 4 */}
                      <div className="grid grid-cols-4 gap-2 text-center font-mono">
                        <div className="bg-gray-50 border border-gray-200 p-2 rounded-lg">
                          <span className="text-[8px] text-brand-text-muted uppercase block">{lang === 'zh' ? '插件总数' : 'Total Plugins'}</span>
                          <span className="text-sm font-bold block mt-0.2">8</span>
                        </div>
                        <div className="bg-emerald-500/5 border border-emerald-500/20 p-2 rounded-lg">
                          <span className="text-[8px] text-brand-success uppercase block">{lang === 'zh' ? '运行状态' : 'Active'}</span>
                          <span className="text-sm font-bold text-brand-success block mt-0.2">7</span>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 p-2 rounded-lg col-span-2 select-none">
                          <span className="text-[8px] text-brand-text-muted uppercase block">{lang === 'zh' ? '运行时编译器引擎' : 'System Runtime Engine'}</span>
                          <span className="text-[10px] text-brand-caramel block font-bold mt-0.5">Bun Core v1.1</span>
                        </div>
                      </div>

                      {/* Plugins cards listing mapping Screenshot 4 */}
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                        {pluginsList.map(plugin => (
                          <div key={plugin.id} className="p-3 bg-gray-50 border border-gray-200 hover:bg-gray-100/60 rounded-xl flex items-center justify-between transition-all gap-2">
                            <div className="space-y-0.5 font-mono text-xs shrink">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`h-1.5 w-1.5 rounded-full block ${plugin.isEnabled ? 'bg-brand-success animate-pulse' : 'bg-gray-400'}`}></span>
                                <strong className="text-brand-text-title text-[12.5px]">{plugin.name}</strong>
                                <span className="text-[9px] text-[#b87351] font-extrabold">{plugin.version}</span>
                                <span className="text-[8px] bg-white border border-gray-200 px-1 rounded text-gray-500 uppercase">{plugin.type}</span>
                              </div>
                              <p className="text-[10px] text-brand-text-muted line-clamp-1 leading-relaxed max-w-[280px]">{plugin.desc}</p>
                            </div>

                            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                              <span className="text-[9px] font-mono text-gray-400 hidden sm:inline">
                                {plugin.isEnabled ? (lang === 'zh' ? '已开启' : 'ON') : (lang === 'zh' ? '已关闭' : 'OFF')}
                              </span>
                              <input 
                                type="checkbox" 
                                checked={plugin.isEnabled}
                                onChange={() => togglePlugin(plugin.id)}
                                className="sr-only peer" 
                              />
                              <div className="relative w-8 h-4 bg-gray-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-200 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-brand-success"></div>
                            </label>
                          </div>
                        ))}
                      </div>

                    </div>
                  )}

                  {/* TAB 6: TOKEN USAGE CONTRIB HEATMAP (Screenshot 5 Style) */}
                  {currentSettingsTab === 'token' && (
                    <div className="space-y-4 animate-fade-in font-sans" id="settings-view-token">
                      
                      {/* Sub Header */}
                      <div className="pb-1 border-b border-brand-border/40">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-base font-bold text-brand-text-title">
                            {lang === 'zh' ? '端侧开发 Token 吞吐量' : 'Token Allocation telemetry'}
                          </h4>
                          <span className="px-1.5 py-0.2 rounded bg-orange-100 border border-orange-200 text-[#b55822] text-[9px] font-bold">2025.06 - 2026.06</span>
                        </div>
                        <p className="text-[11px] text-brand-text-muted mt-0.5">
                          {lang === 'zh' ? '基于包含历史 CLI 执行会话。100% 离线端侧数据审计，隐私零外流。' : 'Raw query stats aggregated from local compilation cycles. 100% telemetry secure.'}
                        </p>
                      </div>

                      {/* Top Three Cards metrics */}
                      <div className="grid grid-cols-3 gap-2 text-center font-mono">
                        <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                          <span className="text-[8px] text-brand-text-muted uppercase block">{lang === 'zh' ? '今天' : 'TODAY'}</span>
                          <span className="block text-sm font-black text-brand-caramel mt-0.5">35M</span>
                          <span className="text-[7.5px] text-brand-text-muted block">
                            {lang === 'zh' ? '2 次端侧会话' : '2 local sessions'}
                          </span>
                        </div>
                        <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                          <span className="text-[8px] text-brand-text-muted uppercase block">{lang === 'zh' ? '昨天' : 'YESTERDAY'}</span>
                          <span className="block text-sm font-black text-[#589c3f] mt-0.5">37M</span>
                          <span className="text-[7.5px] text-brand-text-muted block">
                            {lang === 'zh' ? '10 次端侧会话' : '10 local sessions'}
                          </span>
                        </div>
                        <div className="p-2.5 bg-orange-500/5 border border-orange-200 rounded-xl">
                          <span className="text-[8px] text-orange-850 uppercase block font-bold text-brand-caramel">{lang === 'zh' ? '近30天' : 'TRAILING 30D'}</span>
                          <span className="block text-sm font-black text-[#b87351] mt-0.5">1.6B</span>
                          <span className="text-[7.5px] text-brand-text-muted block">
                            {lang === 'zh' ? '80 次端侧会话' : '80 local sessions'}
                          </span>
                        </div>
                      </div>

                      {/* Contributions Grid Layout mimicking GitHub (Screenshot 5 style) */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2.5">
                        <h5 className="text-[10px] uppercase tracking-wider text-brand-text-muted font-mono font-bold">
                          {lang === 'zh' ? '端侧开发 Token 吞吐热度图' : 'Local Code Generation Throughput Map'}
                        </h5>
                        
                        <div className="flex gap-2">
                          
                          {/* Weekdays Labels */}
                          <div className="flex flex-col justify-between text-[8px] font-mono text-gray-400 py-1 select-none shrink-0 pr-1">
                            <span>{lang === 'zh' ? '周一' : 'Mon'}</span>
                            <span>{lang === 'zh' ? '周三' : 'Wed'}</span>
                            <span>{lang === 'zh' ? '周五' : 'Fri'}</span>
                          </div>

                          {/* Squares container - Mapped exactly like screenshot with warm terracotta orange tones density */}
                          <div className="flex-1 overflow-x-auto">
                            <div className="grid grid-flow-col grid-rows-7 gap-1 min-w-[320px]">
                              {Array.from({ length: 280 }).map((_, cidx) => {
                                // Design specific density levels (0-4) to match beautiful Screenshot 5 layout
                                let density = 0;
                                const isEndColumns = cidx > 220; // Screenshot 5 has extremely intense orange density at the very final weeks (representing late May - June 2026!)
                                const isStartColumns = cidx < 60; // Some moderate usage
                                
                                if (isEndColumns) {
                                  const r = Math.random();
                                  density = r > 0.6 ? 4 : r > 0.3 ? 3 : r > 0.15 ? 2 : 1;
                                } else if (isStartColumns) {
                                  density = Math.random() > 0.65 ? 2 : Math.random() > 0.4 ? 1 : 0;
                                } else {
                                  density = Math.random() > 0.88 ? 3 : Math.random() > 0.75 ? 2 : Math.random() > 0.55 ? 1 : 0;
                                }

                                const colorClasses = [
                                  'bg-gray-200/50 hover:bg-gray-300',
                                  'bg-[#fdd8c5] hover:ring-1 hover:ring-[#b87351]/50',
                                  'bg-[#f0a982] hover:ring-1 hover:ring-[#b87351]',
                                  'bg-[#cc7a4a] hover:scale-[1.05]',
                                  'bg-[#9c4d1d] hover:scale-[1.1]'
                                ];

                                const labelText = density === 4 
                                  ? `${35 + Math.floor(Math.random() * 20)}M Tokens Spelled`
                                  : density === 3 
                                    ? `${22 + Math.floor(Math.random() * 10)}M Tokens`
                                    : density === 2
                                      ? `${10 + Math.floor(Math.random() * 10)}M Tokens`
                                      : density === 1 
                                        ? `${1 + Math.floor(Math.random() * 8)}M Tokens`
                                        : '0 Tokens (Idle/Local Guard)';

                                return (
                                  <div 
                                    key={cidx} 
                                    title={`Date: 2026-${Math.floor(cidx/30) + 6}-${(cidx%30) + 1} | ${labelText}`}
                                    className={`h-2.2 w-2.2 rounded-xs transition-colors cursor-pointer ${colorClasses[density]}`}
                                  ></div>
                                );
                              })}
                            </div>
                          </div>

                        </div>

                        {/* Heatmap Legend */}
                        <div className="flex items-center justify-between text-[9px] font-mono text-gray-400">
                          <span className="flex items-center gap-1 text-xs">
                            <Activity size={10} className="text-brand-caramel shrink-0" />
                            <span>
                              {lang === 'zh' 
                                ? '累计物理会话 921 次 • 峰值吞吐量 63M Tokens/天' 
                                : 'Accumulated 921 physical sessions • Peak throughput 63M/day'}
                            </span>
                          </span>
                          <div className="flex items-center gap-1 select-none">
                            <span>{lang === 'zh' ? '少' : 'Less'}</span>
                            <span className="h-2 w-2 rounded-xs bg-gray-200"></span>
                            <span className="h-2 w-2 rounded-xs bg-[#fdd8c5]"></span>
                            <span className="h-2 w-2 rounded-xs bg-[#f0a982]"></span>
                            <span className="h-2 w-2 rounded-xs bg-[#cc7a4a]"></span>
                            <span className="h-2 w-2 rounded-xs bg-[#9c4d1d]"></span>
                            <span>{lang === 'zh' ? '多' : 'More'}</span>
                          </div>
                        </div>

                      </div>

                    </div>
                  )}

                  {/* TAB 7: COMPUTER USE */}
                  {currentSettingsTab === 'computer' && (
                    <div className="space-y-4 animate-fade-in font-sans" id="settings-view-computer">
                      <div className="flex items-center justify-between pb-2 border-b border-brand-border/40">
                        <div>
                          <div className="flex items-center gap-2">
                             <h4 className="text-base font-bold text-brand-text-title">智能 Computer Use</h4>
                             <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[8px] font-mono font-bold">Tauri OS API</span>
                          </div>
                          <p className="text-[11px] text-brand-text-muted mt-0.5">
                            {lang === 'zh' ? '允许 Agent 代理控制屏幕进行图像捕获或操作流模拟。可在视觉与 UIA 树元树中一键切换。' : 'Authorize autonomous agents to orchestrate cursor actions. Powered by native OS capabilities.'}
                          </p>
                        </div>
                        
                        {/* Power Toggle Switch */}
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <span className="text-[10px] font-mono text-brand-text-muted">
                            {isComputerUseEnabled ? (lang === 'zh' ? '模拟注入开启' : 'Secure Shield On') : (lang === 'zh' ? '硬隔离锁闭' : 'Shield Offed')}
                          </span>
                          <input 
                            type="checkbox" 
                            checked={isComputerUseEnabled}
                            onChange={(e) => {
                              setIsComputerUseEnabled(e.target.checked);
                              triggerToast(e.target.checked 
                                ? (lang === 'zh' ? 'Computer Use 自动注入策略就绪。' : 'Computer Use control routine initialized.') 
                                : (lang === 'zh' ? 'Computer Use 控制流已被强隔离锁闭。' : 'Computer Use loops isolated.'));
                            }}
                            className="sr-only peer" 
                          />
                          <div className="relative w-8 h-4 bg-gray-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-200 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-brand-success"></div>
                        </label>
                      </div>

                      {/* Vision and UIA Tree selection cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                        
                        {/* Strategy 1: Vision Screen Grab */}
                        <div 
                          onClick={() => {
                            setComputerUseMode('vision');
                            triggerToast(lang === 'zh' ? '已切换至 Vision 视觉截图识别元策略。' : 'Switched to screenshot grab loops.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between min-h-[90px] ${computerUseMode === 'vision' ? 'bg-white border-[#b87351] ring-1 ring-[#b87351]/15' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-brand-text-title font-bold">
                              <Eye size={12} className="text-[#b87351]" />
                              <span>{lang === 'zh' ? 'Vision (高密截图匹配)' : 'Vision Screen Capture'}</span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '高频捕获桌面物理无损像素。传递多模态模型定位图像。' : 'Dispatch raw frame image records directly to multimodality classifiers. Handles cross-app styles well.'}
                            </p>
                          </div>
                          <span className="text-[8px] text-brand-caramel font-bold block text-right mt-1 font-mono">
                            {lang === 'zh' ? '图像感知维度 • 适合多模态推理' : 'Multimodality Support • High Token Overhead'}
                          </span>
                        </div>

                        {/* Strategy 2: UIA Node Tree */}
                        <div 
                          onClick={() => {
                            setComputerUseMode('uia');
                            triggerToast(lang === 'zh' ? '已切换至 HTML/UIA Tree 特权无障碍索引。' : 'Enabled accessibility node element matching.');
                          }}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between min-h-[90px] ${computerUseMode === 'uia' ? 'bg-white border-brand-success ring-1 ring-brand-success/15' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-brand-text-title font-bold">
                              <Cpu size={12} className="text-brand-success" />
                              <span>{lang === 'zh' ? '🌲 UIA Tree (系统无障碍树)' : '🌲 UIA Tree (Accessibility)'}</span>
                            </div>
                            <p className="text-[10px] text-brand-text-muted leading-relaxed">
                              {lang === 'zh' ? '深度解析 Windows UI Automation 或 MacOS Accessibility 层次。纯属性匹配，速度飞快，没有偏移误差。' : 'Deconstruct native frame components into pure semantic text trees. Zero positional error.'}
                            </p>
                          </div>
                          <span className="text-[8px] text-brand-success font-bold block text-right mt-1 font-mono">
                            {lang === 'zh' ? '高度节省 40% Token 损耗' : 'Save 40% Token Cost • Offline Speed'}
                          </span>
                        </div>
                      </div>

                      {/* Validations table */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 font-mono text-[10.5px]">
                        <span className="text-[9px] font-bold text-gray-400 block uppercase">
                          {lang === 'zh' ? '宿主运行环境兼容特征检测' : 'OS AGENT RUNTIME COMPATIBILITY DETECTS'}
                        </span>
                        
                        <div className="flex items-center justify-between text-emerald-950">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={11} className="text-brand-success" />
                            <span>{lang === 'zh' ? 'Python 原生编译环境已装载且合法' : 'Python Native Compiling Environment Validated'}</span>
                          </span>
                          <span className="text-gray-400 text-[9px]">{pythonPath}</span>
                        </div>
                        
                        <div className="flex items-center text-emerald-950 gap-1">
                          <CheckCircle2 size={11} className="text-brand-success" />
                          <span>{lang === 'zh' ? '特权虚拟代码环境已独立隔离配置' : 'Isolated Virtual Execution Context (Pyenv Venv)'}</span>
                        </div>

                        <div className="flex items-center text-emerald-950 gap-1">
                          <CheckCircle2 size={11} className="text-brand-success" />
                          <span>{lang === 'zh' ? 'Tauri 屏幕操作外设二进制库挂载完毕' : 'Tauri OS Control Intercept Libraries Registered'}</span>
                        </div>
                      </div>

                      {/* Input interpreter */}
                      <div className="space-y-1 font-mono text-[10px]">
                        <label className="text-gray-400 font-bold block">
                          {lang === 'zh' ? 'Python 原生主解释器执行物理路径 (Pyenv / Anaconda 环)' : 'Python Core Interpreter Path Bindings (Pyenv / Anaconda Guide)'}
                        </label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={pythonPath}
                            onChange={(e) => setPythonPath(e.target.value)}
                            className="flex-1 p-1 px-2 border border-gray-200 bg-white rounded text-xs focus:outline-hidden"
                          />
                          <button 
                            type="button" 
                            onClick={() => {
                              setPythonPath('C:\\Users\\26455\\.pyenv\\shims\\python.exe');
                              triggerToast(lang === 'zh' ? '已自适应匹配 Python Pyenv 物理映射段！' : 'Scanner identified Pyenv venv variables successfully.');
                            }}
                            className="px-2.5 bg-gray-100 border border-gray-200 rounded text-[11px] font-bold hover:bg-gray-200 transition-colors cursor-pointer"
                          >
                            {lang === 'zh' ? '自动检测' : 'Auto Scan'}
                          </button>
                        </div>
                      </div>

                      {/* Actions check bar */}
                      <div className="pt-3 border-t border-gray-100 flex items-center justify-between font-mono text-[11px] select-none">
                        <span className="text-brand-success font-bold flex items-center gap-1">
                          <Check size={12} className="text-brand-success animate-pulse" />
                          <span>{lang === 'zh' ? 'Computer Use 特权接口已完美核定' : 'OS Agent orchestration validation Green'}</span>
                        </span>
                        <button 
                          onClick={triggerCompCheck}
                          disabled={checkingCompUse}
                          className="px-3 py-1 bg-[#b87351] text-white rounded hover:bg-brand-caramel font-bold text-xs flex items-center gap-1 cursor-pointer active:scale-95"
                        >
                          {checkingCompUse ? <RefreshCw size={11} className="animate-spin" /> : <Play size={10} className="fill-current" />}
                          <span>{checkingCompUse ? (lang === 'zh' ? '测试中...' : 'Testing...') : (lang === 'zh' ? '运行首选项检测' : 'Execute Diagnostic')}</span>
                        </button>
                      </div>

                    </div>
                  )}

                </div>
              </div>
            )}

          </div>

        </div>
      </div>
      
      {/* Zoom / Expanded overlay fallback helper */}
      <div className="bg-[#efe8de] px-5 py-3 border-t border-brand-border flex items-center justify-between text-xs font-mono">
        <span className="text-brand-text-muted flex items-center gap-1 flex-wrap">
          <Info size={13} className="text-brand-caramel" />
          <span><b>设计解决机制 #2 & #3</b>：全响应式 HTML 高清重构。在手机（375px）还是高分显示器上，都<b>绝不失真</b>。支持动态全局主题一秒快切换。</span>
        </span>
        <button 
          onClick={() => {
            const el = document.getElementById('tauri-app-viewport');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth' });
              el.classList.add('ring-2', 'ring-brand-caramel');
              setTimeout(() => {
                el.classList.remove('ring-2', 'ring-brand-caramel');
              }, 1200);
            }
          }}
          className="text-brand-caramel hover:underline font-bold inline-flex items-center gap-0.5 pointer-events-auto cursor-pointer"
        >
          <ZoomIn size={12} />
          <span>锁定视觉</span>
        </button>
      </div>
    </div>
  );
}
