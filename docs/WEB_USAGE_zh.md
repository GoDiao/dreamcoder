# DreamCoder 浏览器版使用与进程终止指南

适用于 Ubuntu 24.04 本地开发环境：Bun 启动后端，Node.js 和 npm 启动 Vite 前端。日常使用无需重新安装依赖或构建，也无需编译 Tauri 和 sidecar。

本机验证通过的版本为 Node.js `v24.22.0`、npm `11.19.1`、Bun `1.4.2`。下列命令中的 `/path/to/dreamcoder` 是占位路径，请替换为自己的仓库目录。运行时路径适用于通过 nvm 安装对应 Node 版本、通过默认安装器安装 Bun 的环境；安装位置或版本不同时，请相应调整。

Linux 验证范围、exFAT 安装问题的定位过程和 Ollama 调用结果见[Linux 浏览器版验证报告](LINUX_BROWSER_VALIDATION_zh.md)。

## 日常启动

如果两个服务仍在运行，直接打开 <http://127.0.0.1:1420/>。重启电脑或停止服务后，再按以下步骤启动，避免重复运行多套服务。

### 终端 A 启动后端

```bash
cd /path/to/dreamcoder

export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.bun/bin:$PATH"

bun run src/server/index.ts --host 127.0.0.1 --port 3456
```

看到以下日志表示后端已启动。保持终端 A 运行。

```text
[Server] Claude Code API server running at http://127.0.0.1:3456
```

### 终端 B 启动前端

```bash
cd /path/to/dreamcoder

export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.bun/bin:$PATH"

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
| 提示 `vite: not found` | 使用下面的备用启动命令 |

### 检查后端

在另一个终端执行：

```bash
curl -fsS http://127.0.0.1:3456/health
```

正常响应包含 `"status":"ok"`。连接拒绝表示该地址当前没有可连接的后端服务。

### Vite 启动器丢失时的备用命令

当前依赖安装使用了 `--bin-links=false`，Vite 的 `.bin` 启动器是本地创建的普通文件。删除或重装 `node_modules` 后，该启动器可能丢失。此时可在终端 B 直接运行 Vite 入口，无需修改源码：

```bash
cd /path/to/dreamcoder/desktop

export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.bun/bin:$PATH"

VITE_DESKTOP_SERVER_URL=http://127.0.0.1:3456 \
  node node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 1420 --strictPort
```

此备用方式也需要保留终端 A 的后端服务。

## 依赖发生变化时重新安装

日常启动无需执行本节。当前仓库位于 exFAT，实际测试表明该文件系统不支持符号链接和硬链接；普通安装会在创建 npm 命令链接时出现 `EPERM`。当前本地兼容性安装方式为：

```bash
cd /path/to/dreamcoder

export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.bun/bin:$PATH"

npm install --include=dev --include=optional \
  --package-lock=false --bin-links=false

npm --prefix desktop install --include=dev --include=optional \
  --package-lock=false --bin-links=false
```

以上方式保留原有锁文件，不生成 npm 锁文件。npm 按 `package.json` 的版本范围解析依赖，安装结果可能与 Bun 锁定的版本不同。`--bin-links=false` 会跳过包的命令链接；若 Vite 启动器缺失，使用上一节的备用启动命令。

不要通过 `sudo npm install` 或 `chmod -R 777` 处理这个文件系统限制。若以后迁移到支持符号链接的文件系统，应重新检查安装方式；若仓库正式采用匹配的 npm 锁文件，应使用对应的锁文件安装流程。

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
