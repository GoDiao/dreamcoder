---
sidebar_position: 4
---

# MCP 扩展指南

MCP (Model Context Protocol) 是 DreamCoder 的扩展系统，允许 AI 使用外部工具和资源。

## MCP 简介

MCP 服务器可以提供：
- **代码索引** — 代码搜索、跳转
- **数据库访问** — 直接查询数据库
- **API 集成** — 调用第三方服务
- **文件系统增强** — 高级文件操作

## 添加 MCP 服务器

### 方式一：通过项目配置

在项目根目录创建 `.claude/settings.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed-dir"]
    }
  }
}
```

### 方式二：通过 DreamCoder UI

1. 进入 **设置 → MCP**
2. 点击「添加服务器」
3. 填写服务器配置（命令、参数、环境变量）
4. 保存并自动连接

## 支持的传输类型

| 类型 | 配置示例 | 适用场景 |
|------|----------|----------|
| stdio | `command: "npx", args: ["-y", "server-package"]` | 本地进程 |
| SSE | `url: "https://example.com/mcp"` | 远程服务 |
| StreamableHTTP | `url: "https://example.com/mcp"` | 需保持连接的远程服务 |
| WebSocket | `url: "ws://example.com/mcp"` | 实时双向通信 |

## 常用 MCP 服务器

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search", "--api-key", "YOUR_API_KEY"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

## 故障排除

**Q: MCP 服务器连接失败？**
A: 检查配置格式是否正确，确认命令/依赖已安装，查看日志中的具体错误信息。

**Q: 工具未出现？**
A: 部分服务器需要手动触发工具列表刷新，尝试断开重连。

**Q: 如何查看 MCP 日志？**
A: 在设置页面点击服务器旁的「日志」按钮查看连接日志。