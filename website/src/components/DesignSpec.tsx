import { useState } from 'react';
import { 
  Play, RefreshCw, ZoomIn, Info, Check, Eye, HelpCircle, 
  Menu, ChevronRight, ArrowRight, Layers, Sliders, ChevronDown
} from 'lucide-react';

export default function DesignSpec() {
  const [activeAnim, setActiveAnim] = useState<string | null>(null);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [sliderVal, setSliderVal] = useState(1);

  // Simple test function to trigger flash animations
  const triggerAnimationDemo = (animType: string) => {
    setActiveAnim(animType);
    setTimeout(() => {
      setActiveAnim(null);
    }, 1200);
  };

  return (
    <div id="design-tokens-spec" className="w-full bg-brand-bg-primary border border-brand-border rounded-2xl p-4 md:p-8 space-y-12 shadow-xs">
      
      {/* Title block */}
      <div className="pb-6 border-b border-brand-border">
        <span className="text-xs font-mono font-semibold text-brand-caramel tracking-widest uppercase">System Specifications Guide</span>
        <h2 className="text-2xl md:text-3xl serif-display font-bold text-brand-text-title tracking-tight mt-1 select-none">
          DreamCoder UI 组件设计规范
        </h2>
        <p className="text-xs text-brand-text-muted font-mono mt-1">品牌调性：The Editorial Sanctuary (精致 / 克制 / 纸本技术杂志感 / 拒绝 AI 模板风)</p>
      </div>

      {/* Grid containing core specifications */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Unit (1) Typography system */}
        <div className="space-y-4 p-5 bg-brand-bg-secondary/40 border border-brand-border rounded-xl">
          <h3 className="text-lg serif-display font-bold text-brand-text-title flex items-center gap-2 pb-2 border-b border-brand-border/60">
            <span className="font-sans text-xs bg-brand-caramel text-brand-bg-primary h-5 w-5 rounded-full flex items-center justify-content font-bold">1</span>
            字体与排版层级 (Typography Spec)
          </h3>
          <p className="text-xs text-brand-text-muted leading-relaxed">
            我们拒绝常规、死板的无衬线通俗网页模板。标题及重点引导词采用拥有丰富技术深度与古典艺术气质的 <b>Cormorant Garamond (衬线体)</b>，而代码和机器日志锁定精密的 <b>JetBrains Mono</b>，达到纸本杂志的排版层次。
          </p>

          <div className="space-y-4 pt-2 font-mono">
            <div className="space-y-1">
              <div className="text-[10px] text-brand-text-muted uppercase">Display Headings: Cormorant Garamond</div>
              <div className="text-2xl serif-display font-bold text-brand-text-title">
                DreamCoder: Claude Code 桌面版
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] text-brand-text-muted uppercase">Body Text: Inter / Un-All-Caps</div>
              <div className="font-sans text-xs text-brand-text-body space-y-1 leading-relaxed">
                <p>在本地运行 Claude 编程会话。所有 API 证书和本地资产都在您自己电脑上隔离存储，保证绝对隐私安全。</p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] text-brand-text-muted uppercase">Code / Metadata: JetBrains Mono</div>
              <div className="text-xs text-brand-caramel font-semibold">
                const launchArgs = ["--model", "deepseek-chat", "-local-tunnel"];
              </div>
            </div>
          </div>
        </div>

        {/* Unit (2) Colors Palette */}
        <div className="space-y-4 p-5 bg-brand-bg-secondary/40 border border-brand-border rounded-xl">
          <h3 className="text-lg serif-display font-bold text-brand-text-title flex items-center gap-2 pb-2 border-b border-brand-border/60">
            <span className="font-sans text-xs bg-brand-caramel text-brand-bg-primary h-5 w-5 rounded-full flex items-center justify-content font-bold">2</span>
            意图明确的色彩配比 (Color Palette)
          </h3>
          <p className="text-xs text-brand-text-muted leading-relaxed">
            色彩大底使用温柔护眼的<b>麦芽暖米色 (#f7f4ef)</b> 代替死板的纯白色，全栈主焦糖色严格控制在 <b>10% 面积</b> 之内，主要供 CTA、首要交互与警告边界引导。
          </p>

          {/* Graphical color swatches */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[10px] font-mono">
            <div className="p-2.5 rounded border border-brand-border bg-brand-bg-primary text-brand-text-title font-semibold shadow-2xs">
              <div>主背景 canvas</div>
              <div className="font-bold text-[11px] mt-1">#f7f4ef</div>
            </div>
            <div className="p-2.5 rounded border border-brand-border bg-brand-bg-secondary text-brand-text-title font-semibold shadow-2xs">
              <div>次背景 surface</div>
              <div className="font-bold text-[11px] mt-1">#efe8de</div>
            </div>
            <div className="p-2.5 rounded border border-brand-border bg-brand-bg-card text-brand-text-title font-semibold shadow-2xs">
              <div>容器卡片 card</div>
              <div className="font-bold text-[11px] mt-1">#e8e0d4</div>
            </div>
            <div className="p-2.5 rounded border border-brand-caramel bg-brand-caramel text-brand-bg-primary font-semibold shadow-2xs">
              <div>主色 caramel</div>
              <div className="font-bold text-[11px] mt-1">#b87351</div>
            </div>
            <div className="p-2.5 rounded border border-brand-success bg-brand-success text-brand-bg-primary font-semibold shadow-2xs">
              <div>成功 success</div>
              <div className="font-bold text-[11px] mt-1">#4a9e8c</div>
            </div>
            <div className="p-2.5 rounded border border-brand-highlight bg-brand-highlight text-brand-bg-primary font-semibold shadow-2xs">
              <div>AI 高亮 alert</div>
              <div className="font-bold text-[11px] mt-1">#d4944a</div>
            </div>
          </div>
        </div>

        {/* Unit (3) Interface Interactive Buttons */}
        <div className="space-y-4 p-5 bg-brand-bg-secondary/40 border border-brand-border rounded-xl">
          <h3 className="text-lg serif-display font-bold text-brand-text-title flex items-center gap-2 pb-2 border-b border-brand-border/60">
            <span className="font-sans text-xs bg-brand-caramel text-brand-bg-primary h-5 w-5 rounded-full flex items-center justify-content font-bold">3</span>
            触点圆角与分栏按钮规范 (Interactives)
          </h3>
          <p className="text-xs text-brand-text-muted leading-relaxed">
            按钮规范采用物理圆角（12px），卡片容器限定（16px）。平面优先策略下，按钮默认干净扁平，当触鼠悬停时，自发升起微弱毛皮投影以告知动作权限。
          </p>

          <div className="flex flex-wrap gap-2.5 text-xs font-mono font-bold pt-2 select-none">
            {/* CTA Caramel Button */}
            <button className="px-4 py-2 bg-brand-caramel hover:bg-brand-caramel/90 active:scale-97 text-brand-bg-primary rounded-xl transition duration-200 cursor-pointer shadow-2xs hover:shadow-xs">
              立即下载 Win/Mac 客户端
            </button>
            
            {/* Outline Button */}
            <button className="px-4 py-2 bg-white hover:bg-brand-bg-card active:scale-97 border border-brand-border text-brand-text-title rounded-xl transition duration-200 cursor-pointer shadow-2xs hover:shadow-xs">
              浏览书页文档
            </button>

            {/* Ghost badge Button */}
            <button className="px-3 py-1.5 bg-brand-bg-card hover:bg-brand-border text-brand-text-muted hover:text-brand-text-title rounded-lg text-[11px] transition duration-200 shrink-0 cursor-pointer">
              过滤 Slash 命令
            </button>
          </div>
        </div>

        {/* Unit (4) Hover Elevation Levels */}
        <div className="space-y-4 p-5 bg-brand-bg-secondary/40 border border-brand-border rounded-xl">
          <h3 className="text-lg serif-display font-bold text-brand-text-title flex items-center gap-2 pb-2 border-b border-brand-border/60">
            <span className="font-sans text-xs bg-brand-caramel text-brand-bg-primary h-5 w-5 rounded-full flex items-center justify-content font-bold">4</span>
            拒绝铺张的阴影分级 (Elevation States)
          </h3>
          <p className="text-xs text-brand-text-muted leading-relaxed">
            为了避免界面乱象与眩目，我们<b>绝对禁止使用弥散阴影和发光字</b>。所有的立体感是由细微的 1px 固体线框、底噪颜色、及主动 hover 动作升华的平直平面来赋予。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs select-none">
            {/* Level 1 flat */}
            <div className="p-3 bg-brand-bg-primary border border-brand-border rounded-lg shadow-2xs hover:translate-y-[-1px] transition-transform duration-200">
              <span className="font-bold text-brand-text-title block">Level 1: 基础静默态</span>
              <span className="text-[10px] text-brand-text-muted">默认无复杂悬浮感，1px 灰界分隔。</span>
            </div>
            
            {/* Level 2 triggered */}
            <div className="p-3 bg-white border border-brand-caramel/50 rounded-lg shadow-xs hover:shadow-md transition-all duration-300">
              <span className="font-bold text-brand-caramel block">Level 2: 意图高亮悬停</span>
              <span className="text-[10px] text-brand-text-muted">激活毛皮投影，边框向品牌焦糖过渡。</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lower full width interactive showcase section (Transitions playground) */}
      <div className="mt-8 p-5 md:p-6 bg-[#efe8de] rounded-2xl border border-brand-border space-y-5">
        <div>
          <h3 className="text-xl serif-display font-bold text-brand-text-title flex items-center gap-2">
            设计解决机制 #6：微型交互动效目录 (Transitions Lab)
          </h3>
          <p className="text-xs text-brand-text-muted leading-relaxed mt-1">
            本页面的全部特效在端侧由 <b>motion/react</b> 进行状态流承接。您可以点击下方各个选项，体验交互升华效果。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Anim Preset 1: Fade and scale */}
          <div className="bg-brand-bg-primary p-4 border border-brand-border rounded-xl flex flex-col justify-between space-y-3 font-mono text-xs">
            <div>
              <span className="font-bold text-brand-text-title block text-xs">A: 会话滑入 (Slide Entrance)</span>
              <span className="text-[10px] text-brand-text-muted">当加载新的大单会话时的微距入场动效。</span>
            </div>
            <button 
              onClick={() => triggerAnimationDemo('slide')}
              className="w-full text-center py-1 bg-brand-bg-secondary hover:bg-brand-bg-card font-bold rounded border border-brand-border cursor-pointer transition-colors"
            >
              运行示演示
            </button>
          </div>

          {/* Anim Preset 2: Toast alert flash */}
          <div className="bg-brand-bg-primary p-4 border border-brand-border rounded-xl flex flex-col justify-between space-y-3 font-mono text-xs">
            <div>
              <span className="font-bold text-brand-text-title block text-xs">B: 权限闪烁 (Security Alert)</span>
              <span className="text-[10px] text-brand-text-muted">敏感指令拦截前阻断器高亮摇晃反馈。</span>
            </div>
            <button 
              onClick={() => triggerAnimationDemo('alert')}
              className="w-full text-center py-1 bg-brand-bg-secondary hover:bg-brand-bg-card font-bold rounded border border-brand-border cursor-pointer transition-colors"
            >
              运行示演示
            </button>
          </div>

          {/* Anim Preset 3: Expansion and zoom */}
          <div className="bg-brand-bg-primary p-4 border border-brand-border rounded-xl flex flex-col justify-between space-y-3 font-mono text-xs">
            <div>
              <span className="font-bold text-brand-text-title block text-xs">C: 截图放大 (Expand Viewport)</span>
              <span className="text-[10px] text-brand-text-muted">点击小幅截图以无级插值方式柔顺开启。</span>
            </div>
            <button 
              onClick={() => {
                triggerAnimationDemo('zoom');
                setIsDemoModalOpen(true);
              }}
              className="w-full text-center py-1 bg-brand-caramel text-brand-bg-primary font-bold rounded border border-brand-caramel cursor-pointer transition-all active:scale-97"
            >
              轻触触发测试
            </button>
          </div>

          {/* Anim Preset 4: Dynamic status loop */}
          <div className="bg-brand-bg-primary p-4 border border-brand-border rounded-xl flex flex-col justify-between space-y-3 font-mono text-xs">
            <div>
              <span className="font-bold text-brand-text-title block text-xs">D: 后台同步 (Spin Indicator)</span>
              <span className="text-[10px] text-brand-text-muted">模型加载及网络测试诊断连通同步旋转。</span>
            </div>
            <button 
              onClick={() => triggerAnimationDemo('spin')}
              className="w-full text-center py-1 bg-brand-bg-secondary hover:bg-brand-bg-card font-bold rounded border border-brand-border cursor-pointer transition-colors"
            >
              运行示演示
            </button>
          </div>
        </div>

        {/* Visualizer Target Sandbox showing animated changes */}
        <div className="bg-white border border-brand-border rounded-xl p-6 min-h-[120px] flex items-center justify-center text-center relative overflow-hidden select-none">
          
          {/* Active indicator badge */}
          <div className="absolute top-2.5 left-2.5 text-[9px] font-mono text-brand-text-muted flex items-center gap-1.5 uppercase">
            <span className="h-2 w-2 rounded-full bg-brand-caramel animate-ping"></span>
            活跃反馈区 (Interactive Target Sandbox)
          </div>

          {/* Default Content */}
          {!activeAnim && !isDemoModalOpen && (
            <div className="font-mono text-xs text-brand-text-muted">
              请点击上方任意按钮指令，观察此处的即时状态动画演练
            </div>
          )}

          {/* A: Slide Entrance Demonstration */}
          {activeAnim === 'slide' && (
            <div className="animate-slide-in-right flex flex-col items-center space-y-1.5">
              <span className="inline-block px-2.5 py-1 text-xs border border-brand-success bg-brand-success/15 rounded text-brand-success font-bold font-mono">
                🚀 + 1ms 会话加载及窗口缓存预热完成
              </span>
              <p className="text-[10px] text-brand-text-muted font-mono">Tauri Rust 顺利装配 AST 项目节点树</p>
            </div>
          )}

          {/* B: Security Alert Demonstration */}
          {activeAnim === 'alert' && (
            <div className="animate-shake flex flex-col items-center space-y-1.5">
              <div className="flex items-center gap-1.5 text-red-700 font-bold font-mono text-xs bg-red-50 p-2.5 rounded border border-red-300">
                <Info size={14} className="text-red-600 shrink-0" />
                <span>拦截到敏感提权脚本: sudo rm -rf ./* (已安全前置挂起确认)</span>
              </div>
              <p className="text-[10px] text-brand-text-muted font-mono">DreamCoder 前置零信任层正在等待您的单步滑动允许</p>
            </div>
          )}

          {/* C: Expanded Overlay Representation */}
          {isDemoModalOpen && (
            <div className="fixed inset-0 z-50 bg-brand-text-title/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsDemoModalOpen(false)}>
              <div className="bg-brand-bg-primary max-w-xl w-full border border-brand-border rounded-2xl overflow-hidden shadow-2xl p-6 select-none space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between pb-3 border-b border-brand-border">
                  <span className="serif-display font-bold text-brand-text-title text-base flex items-center gap-1.5">
                    <Layers size={16} className="text-brand-caramel" />
                    高保真界面截图细节放大查看器 (100% Core Scale)
                  </span>
                  <button onClick={() => setIsDemoModalOpen(false)} className="text-brand-text-muted hover:text-brand-caramel font-mono text-xs font-bold leading-none p-1 shrink-0">
                    ✕ 关闭
                  </button>
                </div>
                <div className="bg-[#efe8de] p-4 rounded-xl border border-brand-border space-y-2 text-center">
                  <div className="font-serif italic text-brand-text-muted text-xs">
                    "这是 DreamCoder 设计团队向交付层发出的高清无触点渲染。"
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-brand-border text-left font-mono text-xs text-brand-text-title">
                    <span className="text-brand-caramel font-bold">● Computer Use • UIA 无障碍解析运行</span>
                    <p className="text-brand-text-muted mt-1 leading-relaxed">
                      该机制直接采集操作系统底层的 \`Accessibility Node Trees\`，把所有的图形组件一瞬间还原为 XML 节点树，AI 无需读取屏幕截图即可精准触达，大幅降低 40% 昂贵的高模算力消耗。
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-brand-text-muted pt-2">
                  <span>滑动页面或点击空白区域即可退出极速大图</span>
                  <button onClick={() => setIsDemoModalOpen(false)} className="px-4 py-1 bg-brand-caramel text-white font-bold rounded">
                    我明白了
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* D: Spin Animation Demonstration */}
          {activeAnim === 'spin' && (
            <div className="flex flex-col items-center space-y-2">
              <RefreshCw size={24} className="animate-spin text-brand-caramel" />
              <div className="font-mono text-xs text-brand-text-title">
                正在并行检测本地 14 个 Benchmark 加速组件诊断与延迟...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
