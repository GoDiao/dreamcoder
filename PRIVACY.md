# 隐私政策 / Privacy Policy

最后更新 / Last Updated: 2026-09-27

---

## 中文

DreamCoder 是一款本地运行的 AI Coding Agent 桌面应用。我们尊重并保护用户隐私。

### 数据收集

DreamCoder 的桌面应用和会话服务在本机运行，项目不提供托管的会话服务。使用云端 AI 模型时，应用会向你配置的服务商发送完成请求所需的内容；这可能包括提示词、代码片段和工具结果。使用本地模型端点时，数据流向由该端点的配置决定。

### API 密钥存储

- 用户配置的 Provider 信息及 API 密钥默认写入本地 `~/.claude/dreamcoder/providers.json` 文件；若设置了 `DREAMCODER_CONFIG_DIR`，则写入该目录下的 `dreamcoder/providers.json`。当前实现未使用操作系统 Keychain
- API 密钥仅用于与用户自行选择的 AI 服务商通信
- 请按你的设备安全要求保护该文件和用户账户；不要将其提交到版本库

### 第三方服务

DreamCoder 支持连接用户自行选择的 AI 服务提供商，包括预设和自定义端点。发送给服务商的数据受其隐私政策约束，请在配置前阅读相应条款。

Computer Use 使用第三方开源组件 [cua-driver](https://github.com/trycua/cua)（MIT）。开启时，DreamCoder 从 GitHub 下载固定版本的 cua 官方安装器并校验哈希。cua-driver 默认会发送不含内容的产品遥测；DreamCoder 自己安装时会持久关闭它，每次启动也会带上关闭遥测和更新检查的环境变量。如果你本机已有 cua-driver 并开启了遥测，设置页会提示并提供关闭按钮，但不会替你修改；在 macOS 上，环境变量传不到共用的后台进程，只有持久化设置才对它生效。截图和窗口内容会作为工具结果发送给你选择的 AI 服务商。

启用 H5 接入后，桌面会话可从同一局域网内的浏览器访问；请妥善保管访问 Token。若自行配置反向代理，访问范围和传输安全还取决于你的代理设置。

### 本地存储

应用使用浏览器本地存储（localStorage）保存用户偏好设置，如主题、语言等。这些数据仅存在于用户的设备上。

### 联系我们

如有隐私相关问题，请通过 GitHub Issues 联系：
https://github.com/GoDiao/dreamcoder/issues

---

## English

DreamCoder is a locally-run AI Coding Agent desktop application. We respect and protect user privacy.

### Data Collection

DreamCoder runs its desktop app and session service locally; the project does not provide a hosted session service. When you use a cloud AI model, the app sends the content needed for the request to your configured provider. That content may include prompts, code snippets, and tool results. For a local model endpoint, data flow depends on how you configure that endpoint.

### API Key Storage

- Provider settings and API keys are written to the local `~/.claude/dreamcoder/providers.json` file by default. If `DREAMCODER_CONFIG_DIR` is set, they are written to `dreamcoder/providers.json` under that directory. The current implementation does not use the operating system Keychain
- API keys are used solely to communicate with AI service providers chosen by the user
- Protect this file and your user account according to your device security needs; do not commit it to a repository

### Third-Party Services

DreamCoder can connect to providers you choose through presets or custom endpoints. Data sent to a provider is governed by that provider's privacy policy; review it before configuring the service.

Computer Use uses the third-party open-source component [cua-driver](https://github.com/trycua/cua) (MIT). When you turn it on, DreamCoder downloads cua's official installer for a pinned version from GitHub and checks its hash. cua-driver sends content-free product telemetry by default; when DreamCoder installs it, DreamCoder turns that off persistently, and every session passes variables that turn telemetry and the update check off. If you already have cua-driver installed with telemetry on, the settings page tells you and offers to turn it off, but does not change it for you; on macOS the variables do not reach the shared background process, so only the persisted setting applies to it. Screenshots and window contents are sent as tool results to the AI provider you chose.

When H5 Access is enabled, desktop sessions can be reached from a browser on the same LAN. Protect the access token. If you set up a reverse proxy, its configuration also determines the access scope and transport security.

### Local Storage

The application uses browser local storage (localStorage) to save user preferences such as theme and language settings. This data exists only on the user's device.

### Contact

For privacy-related questions, please reach out via GitHub Issues:
https://github.com/GoDiao/dreamcoder/issues
