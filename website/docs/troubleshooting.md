---
sidebar_position: 7
---

# 故障排除

## Doctor 诊断工具

DreamCoder 内置 Doctor 诊断工具，可修复常见的启动和界面状态问题。

### 使用方法

1. 进入 **设置 → 诊断**
2. 点击「运行 Doctor」
3. 等待诊断完成，查看结果

### Doctor 会修复什么

Doctor 会清理以下 UI 状态数据（**安全数据，绝不触碰敏感信息**）：

| 键名 | 说明 |
|------|------|
| `dreamcoder-open-tabs` | 打开的标签页 |
| `dreamcoder-session-runtime` | 会话运行时状态 |
| `dreamcoder-theme` | 主题设置 |
| `dreamcoder-locale` | 语言设置 |
| `dreamcoder.persistence.schemaVersion` | 存储版本 |

### Doctor 不会触碰

- 聊天历史
- 模型配置
- Skills 配置
- MCP 配置
- OAuth 凭据

## 常见问题

### 启动问题

**Q: 启动后黑屏/白屏？**
A: 运行 Doctor 工具清理 UI 状态，或删除 `%APPDATA%/dreamcoder` 目录下的缓存文件。

**Q: 无法连接本地服务？**
A: 检查端口 3456 是否被占用，确认 `DREAMCODER_SERVER_PORT` 环境变量配置正确。

**Q: API Key 验证失败？**
A: 确认在设置中正确配置了 Provider，尝试重新输入 API Key。

### 网络问题

**Q: 连接超时？**
A: 检查网络代理设置，确认目标 API 服务可访问。可以在设置中测试连接延迟。

**Q: 模型响应慢？**
A: 切换到延迟更低的 Provider，或检查本地网络质量。

### 功能问题

**Q: Computer Use 无法使用？**
A: 确保已授权系统辅助功能权限，运行设置向导检查 Python 环境。

**Q: MCP 服务器连接失败？**
A: 检查服务器配置格式，确认依赖已正确安装。

**Q: 终端无输出？**
A: 重启终端实例，检查系统终端配置。

### 性能问题

**Q: 大项目卡顿？**
A: 在设置中关闭不需要的功能，使用会话隔离不同项目。

---

如果以上方法无法解决问题，请前往 [GitHub Issues](https://github.com/GoDiao/dreamcoder/issues) 搜索或提交问题。