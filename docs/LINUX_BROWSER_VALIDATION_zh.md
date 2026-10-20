# Linux 浏览器版验证报告

Ubuntu 24.04 下已完成 DreamCoder 浏览器界面、Bun 后端和本地 Ollama 模型调用的验证。依赖安装通过 exFAT 兼容方式完成，前端构建及前后端连接正常。**本次验证对象是浏览器版，不是完整的 Linux Tauri 原生客户端；Anthropic Claude 和 OpenAI 官方 API 调用仍待验证。**

日常启动、数据保存、依赖重装、正常关闭和按 PID 终止进程的操作见[浏览器版使用与进程终止指南](WEB_USAGE_zh.md)。

## 环境与验证基线

| 项目 | 本次环境 |
| --- | --- |
| 验证日期 | 2026 年 10 月 20 日 |
| 操作系统 | Ubuntu 24.04.5 LTS |
| 运行验证的代码提交 | `d5413e4a17dea867a7ea51b41dc2a052285c07bd` |
| Node.js | v24.22.0 LTS |
| npm | 11.19.1 |
| Bun | 1.4.2 |
| 前端构建器 | Vite 8.3.4 |
| 仓库存储 | 外置磁盘上的 exFAT，读写挂载 |
| 前端地址 | `http://127.0.0.1:1420/` |
| 后端地址 | `http://127.0.0.1:3456` |
| 模型服务 | 本地 Ollama，`http://127.0.0.1:11434` |
| 已验证模型 | `qwen3.8:latest` |

本报告在后续最新 `main` 上整理为文档 PR；上表保留实际运行验证的代码提交，验证结论不自动覆盖之后的代码变更。固定版本号记录的是本次环境，不是其他版本或所有 Linux 发行版的兼容性承诺。

## 依赖安装错误的定位与处理

### EPERM 来自文件系统的链接限制

此前在根目录和 `desktop/` 执行 Bun 安装时，出现大量 `Failed to link <package>: EPERM`。检查显示仓库和两套旧 `node_modules` 均属于当前用户，目录可写；挂载选项包含 `rw`、`uid=1000`、`gid=1000`、`fmask=0022`、`dmask=0022`。

随后在仓库、`desktop/` 和两套旧依赖目录内创建临时目录进行实际测试，并以 Linux 文件系统上的 `/tmp` 为对照：

| 操作 | 仓库所在 exFAT | `/tmp` 对照 |
| --- | --- | --- |
| 创建普通文件 | 成功 | 成功 |
| 文件改名 | 成功 | 成功 |
| 创建符号链接 | `EPERM` | 成功 |
| 创建硬链接 | `EPERM` | 成功 |

测试文件均已清理。普通文件写入正常而两类链接失败，结合 exFAT 挂载信息，定位为文件系统不支持所需链接操作，而不是普通目录写权限不足。

仅更换包管理器没有解决问题：按要求执行标准 npm 安装后，根目录在创建 `node_modules/.bin/mcpb` 时失败，`desktop/` 在创建 `node_modules/.bin/parser` 时失败，两处均为 `syscall symlink`、`EPERM`。

### 使用 npm 的本地兼容安装方式

原有失败依赖先改名备份，之后分别为根目录和 `desktop/` 做干净安装。两处均没有可用的 `package-lock.json`，因此未使用 `npm ci`；保留 `bun.lock`、`desktop/bun.lock` 和原有 `desktop/pnpm-lock.yaml`，不生成第二套正式锁文件。

在仓库根目录执行的兼容安装命令为：

```bash
npm install --include=dev --include=optional \
  --package-lock=false --bin-links=false

npm --prefix desktop install --include=dev --include=optional \
  --package-lock=false --bin-links=false
```

关键参数 `--bin-links=false` 跳过 npm 可执行命令的符号链接创建。两套安装分别新增 615 和 532 个包；devDependencies 和 optionalDependencies 均包含在内，未出现 peer dependency 冲突。未使用 `sudo npm install`、`chmod -R 777`、`--force` 或 `--legacy-peer-deps`。

这一方式是针对当前 exFAT 环境的本地绕过，文件系统的链接限制仍然存在。跳过命令链接也意味着不能假定所有 `.bin` 命令别名可用。本次为 Vite 创建了普通文件启动器，供 npm scripts 使用；该文件只位于本地忽略的 `node_modules`，没有作为源码提交。指南同时提供直接使用 Node 运行 Vite 入口的备用命令。

`--package-lock=false` 不会让 npm 使用 Bun 或 pnpm 锁定的版本。实际依赖按 `package.json` 的范围重新解析，因此本次成功不等于精确复现 Bun 锁文件，也不等于完成 Bun 到 Node.js 的迁移。

## 前端构建与连接验证

| 检查 | 实际结果 |
| --- | --- |
| Node engines | 所有已安装并声明 Node engines 的包均兼容 Node 24.22.0 |
| 根目录与 desktop 依赖树 | `npm ls --depth=0` 均退出成功 |
| 前端构建 | `npm --prefix desktop run build` 成功，转换 4412 个模块 |
| 原生依赖基本功能 | sharp 生成 PNG、esbuild 转换 TypeScript、resvg 将 SVG 渲染为 PNG 均成功 |
| 页面资源 | 首页、入口 JS、App 模块及样式资源均返回 HTTP 200 |
| 后端健康检查 | `/health` 返回 HTTP 200 和 `status: ok` |
| 基础 API | `/api/status`、`/api/providers`、`/api/models`、`/api/sessions` 均返回 HTTP 200 |
| 跨域请求 | 从前端来源访问后端成功，CORS 预检返回 HTTP 204 |
| WebSocket | 收到 `connected`，发送 `ping` 后收到 `pong` |
| 会话界面 | 新建、重命名、刷新后持久化读取通过 |
| 设置入口 | Providers 设置页面可打开 |

若重新安装后缺少 Vite 的 `.bin` 别名，可在已按指南设置 Node 24 的终端直接调用同一构建入口：

```bash
cd /path/to/dreamcoder/desktop
node node_modules/vite/bin/vite.js build
```

连接过程中曾出现浏览器把 `/health` 请求发到 Vite 的 `1420` 端口，收到 HTML 而导致启动失败。通过启动环境变量 `VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456` 显式指定后端，并重启前端后恢复正常；没有为此修改应用源码。

前端构建保留一条未来兼容性警告：`vite.config.ts` 中的 `__dirname` 不兼容未来计划默认使用的 native config loader。当前构建成功，本次未调整该配置。

npm 11 默认跳过了未批准的 sharp、protobufjs、esbuild 安装脚本；上述原生依赖基本功能已单独实测，不代表其所有执行路径均已覆盖。安装时的自动审计还报告根目录 28 项、desktop 8 项依赖漏洞，本次未升级依赖或执行自动修复。

## 模型 API 调用范围

当前调用链为：浏览器界面 → 本地 Bun 后端 → 本地 Ollama → `qwen3.8:latest`。

| 服务或能力 | 验证状态 |
| --- | --- |
| 本地 Ollama 模型交互 | 用户已完成交互测试；复核时活动服务商为 Ollama，模型列表正常，本地会话存在该模型的用户输入和助手回复 |
| Ollama 模型列表 | 本地 `/api/tags` 返回 HTTP 200，并包含 `qwen3.8:latest` |
| Anthropic Claude 官方 API | 待验证 |
| OpenAI 官方 API | 待验证 |
| 所有工具、多轮恢复及各类模型行为 | 未做全面回归验证 |

当前 Ollama 服务商配置的 `apiFormat` 为 `anthropic`，使用的是本地服务的兼容协议。这不代表已向 Anthropic Claude 官方服务成功发起请求；同样，使用兼容协议也不能证明 OpenAI 官方 API 已通过验证。

## 浏览器版与完整客户端的边界

当前运行的是 React/Vite 浏览器前端和 Bun 后端，不需要为浏览器版启动 Rust、WebKitGTK 或 Tauri。**本次没有构建、打包或运行完整的 Linux Tauri 桌面客户端。** 原生窗口、系统托盘、安装包、自动更新等桌面能力不在此次验证结论内。

完整客户端仍需要准备 Rust/Cargo、对应的 Linux 图形开发库，并构建匹配目标平台的 sidecar，再验证 Tauri 启动和打包流程。环境检查时未找到所需工具链、开发库及 sidecar 二进制；本次没有补装或执行这些流程。

后端及构建流程也仍依赖 Bun，例如：

- `src/server/index.ts` 使用 `Bun.serve`；静态资源及会话等服务还使用 `Bun.file`、`Bun.spawn`。
- `desktop/scripts/build-sidecars.ts` 使用 `Bun.spawn` 和 `Bun.build` 编译 sidecar。
- `desktop/src-tauri/tauri.conf.json` 的开发及构建钩子仍调用 Bun，并要求 sidecar 二进制。
- 根目录 scripts 和 CLI 启动器仍调用 Bun。

## 运行与关闭说明

[使用与进程终止指南](WEB_USAGE_zh.md)随本报告一并提交，包含以下操作：

1. 分别在两个终端启动 Bun 后端和 Vite 前端，显式设置后端地址。
2. 打开浏览器页面，选择模型服务商，确认会话的项目工作目录。
3. 检查后端健康端点，处理地址错误、端口占用和 Vite 启动器缺失。
4. 先停止正在执行的任务，再通过两个终端中的 Ctrl+C 正常关闭服务。
5. 找不到原终端时，通过端口找到 PID，核对进程用户、启动时间、命令和工作目录后发送 SIGTERM。
6. 仅在正常终止无效且再次核对身份后使用 SIGKILL，并重新检查端口和残留子进程。

强制终止不会执行后端清理逻辑，可能中断写入或留下子进程。指南不使用按 `node` 或 `bun` 名称批量结束进程的方式。

本 PR 仅提交验证报告、使用指南及 README 入口；不包含凭据、聊天内容、原始运行日志、依赖目录或构建产物。
