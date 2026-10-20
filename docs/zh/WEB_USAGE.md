# DreamCoder 浏览器版使用与进程终止指南

[English](../WEB_USAGE.md) | 简体中文

适用于 Ubuntu 24.04 本地开发环境：Bun 启动后端，Node.js 和 npm 启动 Vite 前端。日常使用无需重新安装依赖或构建，也无需编译 Tauri 和 sidecar。

请确保 `bun`、`node` 和 `npm` 已在 `PATH` 中。建议使用 Node.js 24 LTS；本次验证版本为 Node.js `v24.22.0`、npm `11.19.1` 和 Bun `1.4.2`。下列命令中的 `/path/to/dreamcoder` 是占位路径，请替换为自己的仓库目录。

Linux 验证范围、exFAT 安装问题的定位过程和 Ollama 调用结果见[Linux 浏览器版验证报告](LINUX_BROWSER_VALIDATION.md)。

## 标准依赖安装

首次配置或依赖发生变化时，按照项目的标准 Bun 流程，分别安装根目录和 `desktop/` 的依赖：

```bash
cd /path/to/dreamcoder
bun install
(cd desktop && bun install)
```

这些命令使用仓库的 Bun 锁文件。ext4 等支持符号链接的常见 Linux 文件系统应使用此流程，日常启动无需重复安装。若在 exFAT 上出现链接操作的 `EPERM`，先查看下方“已知问题”，再考虑 npm 绕过方式。

## 日常启动

如果两个服务仍在运行，直接打开 <http://127.0.0.1:1420/>。重启电脑或停止服务后，再按以下步骤启动，避免重复运行多套服务。

### 终端 A 启动后端

```bash
cd /path/to/dreamcoder

bun run src/server/index.ts --host 127.0.0.1 --port 3456
```

看到以下日志表示后端已启动。保持终端 A 运行。

```text
[Server] Claude Code API server running at http://127.0.0.1:3456
```

### 终端 B 启动前端

```bash
cd /path/to/dreamcoder

VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 \
  npm --prefix desktop run dev -- \
  --host 127.0.0.1 --port 1420 --strictPort
```

看到 Vite 输出访问地址后，打开 <http://127.0.0.1:1420/>，并保持终端 B 运行。`VITE_DESKTOP_SERVER_URL` 指定前端连接的后端地址，启动时应保留。

| 服务 | 地址 | 用途 |
| --- | --- | --- |
| 前端 | `http://127.0.0.1:1420/` | 浏览器界面 |
| 后端 | `http://127.0.0.1:3456` | API 和 WebSocket |
| 健康检查 | `http://127.0.0.1:3456/health` | 确认后端存活 |

这些命令仅监听本机回环地址。其他电脑或手机不能通过该地址访问。

## 开始使用与数据保存

1. 打开页面，已保存的服务商配置和聊天记录会自动读取。
2. 如果尚未配置模型，点击 **Add Provider**，或进入 **Settings → Providers**，配置服务商、API Key 和模型。
3. 点击 **New session** 新建会话，开始执行任务前确认工作目录指向目标项目。

本次已验证的服务商是本地 Ollama，模型为 `qwen3.8:latest`。使用前应确认自己的 Ollama 服务正在运行，且所选模型已安装。Anthropic Claude 和 OpenAI 官方 API 的实际调用仍待验证；本地兼容接口的成功调用不能替代这些验证。

**启动服务时所在的仓库目录，不等于会话的工作目录。** 本次启动验证中，新建会话默认使用当前用户的主目录；应在界面中确认实际项目路径。

未设置 `DREAMCODER_CONFIG_DIR` 时，默认配置及聊天数据保存在 `$HOME/.dreamcoder/`。备份时应包含这个目录，并妥善保管其中的凭据。如果设置了该环境变量，则以指定目录为准。

## 正常停止

如有任务正在执行，先在页面停止生成并等待任务结束，再在终端 A、B 中分别按 **Ctrl+C**。后端收到退出信号后会清理活动会话的 CLI 子进程。

仅关闭浏览器页面不会停止服务。无法找到原终端时，使用本文末尾的进程终止步骤。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 页面打不开 | 检查终端 B 是否仍在运行，以及 Vite 是否输出错误 |
| 页面出现健康检查失败 | 检查终端 A，并确认前端启动命令包含 `VITE_DESKTOP_SERVER_URL` |
| 提示端口已占用 | 先尝试使用现有页面；需要重启时，按本文末尾步骤确认并结束旧服务 |
| 提示未配置服务商 | 在 **Settings → Providers** 检查服务商和当前模型 |
| 提示 `vite: not found` | 先完成两处标准依赖安装；若使用 exFAT 绕过方式，查看下方 Vite 备用命令 |

### 检查后端

在另一个终端执行：

```bash
curl -fsS http://127.0.0.1:3456/health
```

正常响应包含 `"status":"ok"`。连接拒绝表示该地址当前没有可连接的后端服务。

## 已知问题

### exFAT 链接错误与 npm 绕过方式

本次验证的工作区位于 exFAT，普通文件写入和改名正常，但符号链接与硬链接操作返回 `EPERM`；标准 npm 安装也在创建命令链接时失败。[验证报告](LINUX_BROWSER_VALIDATION.md)记录了实际测试与定位过程。仅凭 `EPERM` 不能认定是这一原因，应先检查所属用户、权限、文件系统类型和实际链接能力。

仅对已确认受到该文件系统限制的工作区，先备份失败的依赖目录，再使用以下本地绕过方式进行干净安装：

```bash
cd /path/to/dreamcoder

npm install --include=dev --include=optional \
  --package-lock=false --bin-links=false

npm --prefix desktop install --include=dev --include=optional \
  --package-lock=false --bin-links=false
```

这不是 ext4 等支持符号链接的文件系统的标准安装流程。以上命令保留现有锁文件且不生成 npm 锁文件，但 npm 按 `package.json` 范围解析版本，不会使用 `bun.lock` 的锁定结果，因此实际依赖可能不同。`--bin-links=false` 跳过命令链接创建，不会消除底层文件系统限制。

不要通过 `sudo npm install` 或 `chmod -R 777` 处理这一限制。迁移到支持符号链接的文件系统后，应使用上方的标准 Bun 安装流程。

### exFAT 绕过后 Vite 启动器缺失

使用 `--bin-links=false` 安装后，Vite 的 `.bin` 启动器可能不存在。本次验证环境曾单独创建普通文件启动器；删除或重装 `node_modules` 后，这个启动器也可能丢失。此时可在终端 B 直接运行 Vite：

```bash
cd /path/to/dreamcoder/desktop

VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 \
  node node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 1420 --strictPort
```

此备用方式也需要保留终端 A 的后端服务。

## 进程终止指南

本节用于原终端已关闭、服务残留或端口被占用的情况。结束后端会中断正在执行的任务，先在页面停止任务；能找到原终端时，优先使用 **Ctrl+C**。

以下命令中的 `PID` 均为占位符，必须替换为本次检查得到的进程编号，不要原样执行，也不要复用上次运行的 PID。

### 第一步 查找占用端口的进程

在终端执行以下只读命令：

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN
lsof -nP -iTCP:3456 -sTCP:LISTEN
```

输出的 `PID` 列就是监听进程编号。也可以查看两个端口的监听情况：

```bash
ss -ltnp '( sport = :1420 or sport = :3456 )'
```

没有对应监听输出，说明端口当前未被监听，无需为了该端口执行 kill。端口被占用并不代表占用者一定是 DreamCoder，必须继续核对。

### 第二步 核对进程身份

将 `PID` 替换为刚查到的数字，查看所属用户、启动时间、完整启动参数和工作目录：

```bash
ps -ww -p PID -o pid,ppid,user,lstart,args
readlink -f /proc/PID/cwd
```

本指南启动的前端通常是运行 `vite.js` 的 `node` 进程，工作目录位于当前仓库的 `desktop/`。后端启动参数应包含 `bun run src/server/index.ts`，工作目录为当前仓库。若启动参数不同，应结合实际路径确认身份。

只结束已确认属于本次 DreamCoder 服务、由自己启动的进程。如果是其他项目或其他用户的进程，先确认用途，不要为了释放端口直接终止。

### 第三步 发送正常终止信号

确认身份后，对目标 PID 执行：

```bash
kill -TERM PID
```

有前后端两个进程时，分别对已确认的 PID 执行。`SIGTERM` 允许后端运行退出清理逻辑，包括停止活动会话的 CLI 子进程。

等待几秒后，再次检查端口：

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN
lsof -nP -iTCP:3456 -sTCP:LISTEN
```

端口不再被监听后，即可按照本文开头步骤重新启动。若端口立即被新进程重新占用，应检查新 PID 的启动参数和父进程；如果服务由进程管理器启动，应通过该管理器停止服务。

### 第四步 无响应时才强制结束

仅当 `SIGTERM` 后进程仍未退出时，再用 `ps` 核对 PID、启动时间及命令，确认仍是同一个 DreamCoder 进程，然后执行：

```bash
kill -KILL PID
```

这等同于 `kill -9 PID`。强制结束不会执行应用的退出清理，可能中断写入或留下 CLI 子进程，因此应作为最后手段。执行后再次检查两个端口；如有残留进程，逐个核对身份再处理。

不要使用 `killall node`、`killall bun`、宽泛的 `pkill -f`，或未经核对就执行 `fuser -k`。这些命令可能同时终止其他项目。也不要把 `0`、`1` 或负数当作目标 PID。

终止进程不需要删除 `node_modules`、聊天记录、`$HOME/.dreamcoder/` 或修改源码。
