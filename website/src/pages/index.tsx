import React from 'react';
import Link from '@docusaurus/Link';
import styles from './index.module.css';
import ArchitectureGraph from '../components/ArchitectureGraph';
import PerfDashboard from '../components/PerfDashboard';

const features = [
  {
    icon: '🖥️',
    title: '原生桌面体验',
    description: '多标签页会话管理，内置 PTY 终端，窗口状态自动记忆，开箱即用。',
  },
  {
    icon: '🤖',
    title: 'Computer Use 模式',
    description: '支持截图视觉模式 + UIA Tree 文本模式，成本更低速度更快。',
  },
  {
    icon: '🔌',
    title: '全模型支持',
    description: 'DeepSeek、通义千问、Kimi、MiniMax、Claude、GPT 一键切换。',
  },
  {
    icon: '🛡️',
    title: '安全审批流',
    description: '危险操作逐条确认，API Key 本地加密，隐私零风险。',
  },
  {
    icon: '🔧',
    title: 'MCP 扩展',
    description: 'Model Context Protocol 原生支持，插件生态无限扩展。',
  },
  {
    icon: '⚡',
    title: '极致性能',
    description: '14 项深度优化，会话元数据缓存���现 24.8 倍性能提升。',
  },
];

export default function Home(): JSX.Element {
  return (
    <main className={styles.main}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroText}>
            <div className={styles.badge}>
              <span className={styles.badgeDot}></span>
              开源免费 · MIT 许可证
            </div>

            <h1 className={styles.heroTitle}>
              <span className={styles.titleLine1}>DreamCoder</span>
              <span className={styles.titleLine2}>Claude Desktop 开源版</span>
            </h1>

            <p className={styles.heroSubtitle}>
              把 Claude Code 强大的核心引擎，封装进现代原生桌面应用。
              面向国内开发者的 AI 编程工作台，无需科学上网。
            </p>

            <div className={styles.heroCta}>
              <a href="https://github.com/GoDiao/dreamcoder/releases" className={styles.primaryBtn}>
                立即下载
              </a>
              <Link to="/docs/intro" className={styles.secondaryBtn}>
                查看文档 →
              </Link>
            </div>

            <div className={styles.heroStats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>14</span>
                <span className={styles.statLabel}>项性能优化</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>8+</span>
                <span className={styles.statLabel}>模型供应商</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>100%</span>
                <span className={styles.statLabel}>本地隐私</span>
              </div>
            </div>
          </div>

          {/* Dark Code Editor Card */}
          <div className={styles.heroCard}>
            <div className={styles.terminalWindow}>
              <div className={styles.terminalHeader}>
                <div className={styles.terminalDots}>
                  <span className={styles.dotRed}></span>
                  <span className={styles.dotYellow}></span>
                  <span className={styles.dotGreen}></span>
                </div>
                <span className={styles.terminalTitle}>DreamCoder — Claude Desktop 开源版</span>
              </div>
              <div className={styles.terminalBody}>
                <div className={`${styles.terminalLine} ${styles.terminalPrompt}`}>$ dreamcoder init my-project</div>
                <div className={`${styles.terminalLine} ${styles.terminalSuccess}`}>✓ Initializing DreamCoder...</div>
                <div className={`${styles.terminalLine} ${styles.terminalSuccess}`}>✓ Loading Claude 3.5 Sonnet...</div>
                <div className={`${styles.terminalLine} ${styles.terminalSuccess}`}>✓ Connected to DeepSeek V3 (12ms)</div>
                <div className={`${styles.terminalLine}`}></div>
                <div className={`${styles.terminalLine} ${styles.terminalAi}`}>🤖 有什么可以帮你的？</div>
                <div className={`${styles.terminalLine} ${styles.terminalUser}`}>> 帮我写一个 REST API</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section className={styles.architectureSection}>
        <div className="container">
          <h2 className={styles.sectionTitle}>
            技术<span className={styles.highlight}>架构</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            四层协同：UI 层 → Rust 核心 → Bun 运行时 → 云端模型
          </p>
          <ArchitectureGraph />
        </div>
      </section>

      {/* Why Section */}
      <section className={styles.whySection}>
        <div className="container">
          <h2 className={styles.sectionTitle}>
            为什么选择 <span className={styles.highlight}>DreamCoder</span>？
          </h2>
          <p className={styles.sectionSubtitle}>
            对比纯命令行和其他 GUI 方案，DreamCoder 为国内开发者量身打造
          </p>

          <div className={styles.compareTable}>
            <div className={styles.compareHeader}>
              <div className={styles.compareCell}></div>
              <div className={styles.compareCell}>纯 CLI</div>
              <div className={styles.compareCell}>浏览器插件</div>
              <div className={`${styles.compareCell} ${styles.compareCellHighlight}`}>DreamCoder</div>
            </div>
            <div className={styles.compareRow}>
              <div className={styles.compareCell}>国内网络</div>
              <div className={styles.compareCell}>❌ 需翻墙</div>
              <div className={styles.compareCell}>⚠️ 不稳定</div>
              <div className={`${styles.compareCell} ${styles.compareCellHighlight}`}>✅ 原生直连</div>
            </div>
            <div className={styles.compareRow}>
              <div className={styles.compareCell}>模型切换</div>
              <div className={styles.compareCell}>❌ 手动配置</div>
              <div className={styles.compareCell}>⚠️ 单一绑定</div>
              <div className={`${styles.compareCell} ${styles.compareCellHighlight}`}>✅ 一键切换</div>
            </div>
            <div className={styles.compareRow}>
              <div className={styles.compareCell}>可视化 Diff</div>
              <div className={styles.compareCell}>❌ 终端查看</div>
              <div className={styles.compareCell}>⚠️ 无法同步</div>
              <div className={`${styles.compareCell} ${styles.compareCellHighlight}`}>✅ 侧边栏对比</div>
            </div>
            <div className={styles.compareRow}>
              <div className={styles.compareCell}>安全审批</div>
              <div className={styles.compareCell}>❌ 无</div>
              <div className={styles.compareCell}>⚠️ 弱</div>
              <div className={`${styles.compareCell} ${styles.compareCellHighlight}`}>✅ 逐条确认</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid - Cream Cards */}
      <section className={styles.featuresSection}>
        <div className="container">
          <h2 className={styles.sectionTitle}>核心功能</h2>
          <div className={styles.featuresGrid}>
            {features.map((feature, idx) => (
              <div key={idx} className={styles.featureCard}>
                <div className={styles.featureIcon}>{feature.icon}</div>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureDesc}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Performance Section - Dark Surface */}
      <section className={styles.benchmarkSection}>
        <div className="container">
          <h2 className={styles.sectionTitle}>极致性能优化</h2>
          <p className={styles.sectionSubtitle}>
            14 项深度优化，让大项目也能丝滑运行
          </p>
          <PerfDashboard />
        </div>
      </section>

      {/* CTA Section - Coral Full Bleed */}
      <section className={styles.ctaSection}>
        <div className="container">
          <h2 className={styles.ctaTitle}>准备好升级你的编程体验了吗？</h2>
          <p className={styles.ctaSubtitle}>
            完全开源，MIT 许可证，企业和个人均可免费使用
          </p>
          <div className={styles.ctaButtons}>
            <a href="https://github.com/GoDiao/dreamcoder/releases" className={styles.primaryBtn}>
              立即下载
            </a>
            <a href="https://github.com/GoDiao/dreamcoder" className={styles.secondaryBtn}>
              ⭐ Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer - Dark Navy */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerColumn}>
            <h4>产品</h4>
            <a href="/docs/intro">快速开始</a>
            <a href="/docs/security">安全说明</a>
            <a href="https://github.com/GoDiao/dreamcoder/releases">下载</a>
          </div>
          <div className={styles.footerColumn}>
            <h4>资源</h4>
            <a href="https://github.com/GoDiao/dreamcoder">GitHub</a>
            <a href="https://github.com/GoDiao/dreamcoder/issues">问题反馈</a>
            <a href="https://github.com/GoDiao/dreamcoder/discussions">讨论区</a>
          </div>
          <div className={styles.footerColumn}>
            <h4>社区</h4>
            <a href="https://github.com/GoDiao/dreamcoder/stargazers">Stars</a>
            <a href="https://github.com/GoDiao/dreamcoder/forks">Forks</a>
          </div>
          <div className={styles.footerColumn}>
            <h4>法律</h4>
            <a href="https://github.com/GoDiao/dreamcoder/blob/master/LICENSE">MIT 许可证</a>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span className={styles.footerCopyright}>
            © 2024-{new Date().getFullYear()} GoDiao & DreamCoder Contributors
          </span>
        </div>
      </footer>
    </main>
  );
}