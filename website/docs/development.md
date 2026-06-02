---
sidebar_position: 8
---

# 开发指南

本节面向希望从源码编译或贡献代码的开发者。

## 本地开发环境

### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Bun | >= 1.0 | 运行时 |
| Rust | 最新稳定版 | 桌面端编译 |
| Node.js | >= 18 | 部分依赖需要 |

### 开发流程

```bash
# 1. 克隆仓库
git clone https://github.com/GoDiao/dreamcoder.git
cd dreamcoder

# 2. 安装依赖
bun install

# 3. 启动桌面端开发模式
cd desktop && bun run dev
```

### 项目结构

```
dreamcoder/
├── desktop/           # Tauri 桌面端 (React + TypeScript)
│   └── src/
│       ├── api/       # 前端 API 调用
│       ├── components/# React 组件
│       ├── pages/     # 页面组件
│       └── stores/    # Zustand 状态管理
├── src/               # Sidecar 后端 (Bun + TypeScript)
│   └── server/
│       ├── api/       # API 路由
│       ├── providers/ # 模型供应商适配
│       └── config/    # 配置文件
├── sidecar/           # Python 运行时辅助
└── website/           # Docusaurus 文档网站
```

### 运行测试

```bash
# 根目录测试
bun test

# 桌面端测试
cd desktop && bun run test
```

### 构建发布

```bash
# 构建桌面端
bun run build:desktop

# 构建 sidecar
bun run build:sidecar
```

## 代码规范

- 使用 TypeScript
- 遵循 ESLint 配置
- 前端组件使用 React Hooks
- 后端使用 Zod 进行数据校验

## 提交 PR

1. Fork 仓库
2. 创建功能分支: `git checkout -b feature/xxx`
3. 提交更改: `git commit -m "feat: 添加 xxx 功能"`
4. 推送分支: `git push origin feature/xxx`
5. 打开 Pull Request

## 相关文档

- [快速开始](./intro.md)
- [安装配置](./install.md)
- [Computer Use 模式](./computer-use.mdx)