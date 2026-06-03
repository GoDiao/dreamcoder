import React from 'react';
import styles from './ArchitectureGraph.module.css';

const architectureData = {
  layers: [
    {
      name: 'UI 层',
      color: '#e8e0d4',
      textColor: '#1a1816',
      borderColor: '#dad4c8',
      items: ['会话多标签页', '可视化 Diff 面板', '集成终端 xterm.js'],
      icon: ''
    },
    {
      name: 'Rust 核心',
      color: '#efe8de',
      textColor: '#1a1816',
      borderColor: '#b87351',
      items: ['窗口状态持久化', '安全审批闸口', 'PTY 终端控制'],
      icon: ''
    },
    {
      name: 'Bun 运行时',
      color: '#e8e0d4',
      textColor: '#1a1816',
      borderColor: '#4a9e8c',
      items: ['AI Agent 引擎', 'Provider 路由', 'MCP 工具服务'],
      icon: ''
    },
    {
      name: '云端模型',
      color: '#f7f4ef',
      textColor: '#1a1816',
      borderColor: '#95928e',
      items: ['DeepSeek', 'Kimi', 'MiniMax', 'Claude', '通义千问'],
      icon: ''
    }
  ],
  flows: [
    { from: 0, to: 1, label: 'HTTP / WebSocket' },
    { from: 1, to: 2, label: 'Sidecar IPC' },
    { from: 2, to: 3, label: '全模型直连' }
  ]
};

const keyFeatures = [
  { icon: '', title: '本地安全沙盒', desc: '所有 API Key 和会话数据仅存储本地，不上传任何凭据到云端' },
  { icon: '', title: '极速 IPC 直连', desc: 'Sidecar 进程通过管道传输，延迟 < 1ms，告别 WebSocket 双跳' },
  { icon: '', title: '国内原生直连', desc: 'DeepSeek / Kimi / MiniMax 等主流模型，无需科学上网' }
];

export default function ArchitectureGraph() {
  return (
    <div className={styles.graphWrapper}>
      <div className={styles.layersGrid}>
        {architectureData.layers.map((layer, layerIdx) => (
          <div
            key={layerIdx}
            className={styles.layerCard}
            style={{
              '--layer-bg': layer.color,
              '--layer-text': layer.textColor,
              '--layer-border': layer.borderColor,
            } as React.CSSProperties}
          >
            <div className={styles.layerIcon}>{layer.icon}</div>
            <h3 className={styles.layerName}>{layer.name}</h3>
            <div className={styles.layerItems}>
              {layer.items.map((item, itemIdx) => (
                <span key={itemIdx} className={styles.layerItemTag}>{item}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.flowRow}>
        {architectureData.flows.map((flow, idx) => (
          <div key={idx} className={styles.flowArrow}>
            <span className={styles.flowLabel}>{flow.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.featuresGrid}>
        {keyFeatures.map((feature, idx) => (
          <div key={idx} className={styles.featureCardDark}>
            <div className={styles.featureIcon}>{feature.icon}</div>
            <h4 className={styles.featureTitle}>{feature.title}</h4>
            <p className={styles.featureDesc}>{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}