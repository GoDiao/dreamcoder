/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PageRoute = 'landing' | 'docs' | 'spec';

export interface FeatureCard {
  id: string;
  icon: string; // lucide icon name
  title: string;
  description: string;
}

export interface MetricHighlight {
  value: string;
  label: string;
  description: string;
}

export interface ComparisonRow {
  criteria: string;
  cli: string;
  extension: string;
  dreamcoder: string;
  isDreamCoderBetter?: boolean;
}

export interface SettingScreenshot {
  id: string;
  title: string;
  description: string;
  imagePath: string;
  badge: string;
  tags: string[];
}

export interface DocArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  content: string;
}

export interface BenchmarkData {
  metric: string;
  dreamcoder: string;
  competitor: string;
  improvement: string;
  category: 'performance' | 'resource' | 'ux';
}

export interface DesignComponentSpec {
  name: string;
  description: string;
  usage: string;
}
