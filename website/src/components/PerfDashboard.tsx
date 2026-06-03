import React from 'react';
import styles from './PerfDashboard.module.css';

const benchmarks = [
  {
    name: '会话元数据缓存',
    before: 2020,
    after: 81,
    unit: 'ms',
    improvement: '24.8x',
    badgeClass: ''
  },
  {
    name: 'Elapsed Timer 外置',
    before: 10.91,
    after: 6.74,
    unit: 'ms',
    improvement: '1.6x',
    badgeClass: styles.improvementBadgeTeal
  },
  {
    name: 'Markdown 渲染',
    before: 105,
    after: 0,
    unit: 'μs',
    improvement: '主线程解放',
    badgeClass: styles.improvementBadgeAmber,
    note: 'useDeferredValue'
  }
];

const summaryStats = [
  { value: '14', label: '项深度优化', icon: '' },
  { value: '100%', label: '本地隐私保护', icon: '' },
  { value: '', label: '主线程自由', icon: '' }
];

export default function PerfDashboard() {
  const maxBefore = Math.max(...benchmarks.map(b => b.before));

  return (
    <div className={styles.dashboardWrapper}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {benchmarks.map((item, idx) => (
          <div key={idx} className={styles.benchmarkCard}>
            <div className={styles.benchmarkHeader}>
              <h3 className={styles.benchmarkName}>{item.name}</h3>
              <span className={`${styles.improvementBadge} ${item.badgeClass}`}>
                {item.improvement}
              </span>
            </div>

            <div className={styles.barContainer}>
              <div className={styles.barLabel}>
                <span className={styles.barLabelBefore}>Before</span>
                <span className={styles.barLabelBefore}>{item.before}{item.unit}</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFillBefore}
                  style={{ width: item.before === 0 ? '0%' : `${(item.before / maxBefore) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className={styles.barLabel}>
                <span className={styles.barLabelAfter}>After</span>
                <span className={styles.barLabelAfter}>
                  {item.after === 0 ? item.note : `${item.after}${item.unit}`}
                </span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFillAfter} ${idx === 2 ? styles.barFillAfterAmber : ''}`}
                  style={{
                    width: item.after === 0 ? '15%' : `${Math.max((item.after / maxBefore) * 100, 8)}%`
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.statsGrid}>
        {summaryStats.map((stat, idx) => (
          <div key={idx} className={styles.statCard}>
            <div className={styles.statIcon}>{stat.icon}</div>
            <div className={styles.statValue}>{stat.value}</div>
            <div className={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}