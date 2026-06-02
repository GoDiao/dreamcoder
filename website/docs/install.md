---
sidebar_position: 2
---

# 安装与配置

## 环境要求

| 工具 | 版本要求 | 备注 |
|------|---------|------|
| Windows | 10/11 (64位) | 当前仅支持 Windows |
| [Bun](https://bun.sh/) | >= 1.0 | 本地开发运行时 |
| [Rust](https://www.rust-lang.org/tools/install) | 最新稳定版 | 桌面端编译 |

## 安装步骤

### 方式一：下载安装包（推荐）

前往 [GitHub Releases](https://github.com/GoDiao/dreamcoder/releases) 下载最新版本：

| 安装包 | 说明 |
|--------|------|
| `DreamCoder_x.x.x_x64-setup.exe` | Windows 安装向导 |
| `DreamCoder_x.x.x_x64_en-US.msi` | MSI 静默安装包 |

下载后双击运行，按提示完成安装即可。

### 方式二：从源码编译

```bash
# 1. 克隆仓库
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 2. 安装依赖
bun install

# 3. 启动桌面端开发模式
cd desktop && bun run dev
```

## 配置 AI 模型

1. 打开 DreamCoder，进入 **设置 → Provider (模型供应商)**
2. 添加你的 API Key
3. 选择默认模型，即可开始编程

### 支持的模型供应商

| 供应商 | API 格式 | 特点 |
|--------|----------|------|
| DreamField 官方 | Anthropic | 官方推荐，国内直连 |
| DeepSeek 官方 | Anthropic | 性价比高，1M context |
| 通义千问 (Qwen) | OpenAI Chat | 阿里系 |
| Kimi (Moonshot) | Anthropic | 262K context |
| 智谱 GLM | Anthropic | 清华系 |
| LM Studio | Anthropic | 本地大模型 |
| Ollama | Anthropic | 本地大模型 |
| 自定义 | 可配置 | 自建 API 服务 |

## 环境变量配置

DreamCoder 支持通过环境变量进行配置。

### 常用变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | - |
| `DREAMCODER_SERVER_PORT` | 本地服务端口 | `3456` |
| `DREAMCODER_LOG_LEVEL` | 日志级别 (`debug`/`info`/`warn`) | `info` |

### 使用 .env 文件

在项目根目录创建 `.env` 文件：

```bash
# .env 示例
ANTHROPIC_API_KEY=sk-ant-your-key-here
DEEPSEEK_API_KEY=sk-your-key-here
DREAMCODER_SERVER_PORT=3456
DREAMCODER_LOG_LEVEL=info
```

:::tip
生产环境建议使用 UI 设置界面管理 API Key，DreamCoder 会将凭据加密存储在本地。
:::