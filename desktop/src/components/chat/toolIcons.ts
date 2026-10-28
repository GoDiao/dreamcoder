import { Terminal, FileText, Edit3, FileEdit, Search, FileSearch, Bot, Globe, Download, File, Sparkles, Wrench, MousePointerClick, Keyboard, ScanEye, AppWindow, Clipboard, Monitor, type LucideIcon } from 'lucide-react'
import type { CuaToolIcon } from '../../lib/cuaToolDisplay'

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: Edit3,
  Edit: FileEdit,
  Glob: Search,
  Grep: FileSearch,
  Agent: Bot,
  WebSearch: Globe,
  WebFetch: Download,
  NotebookEdit: File,
  Skill: Sparkles,
}

const CUA_TOOL_ICONS: Record<CuaToolIcon, LucideIcon> = {
  pointer: MousePointerClick,
  keyboard: Keyboard,
  screen: ScanEye,
  app: AppWindow,
  browser: Globe,
  clipboard: Clipboard,
  other: Monitor,
}

export function getToolIcon(toolName: string, cuaIcon?: CuaToolIcon): LucideIcon {
  return cuaIcon ? CUA_TOOL_ICONS[cuaIcon] : TOOL_ICONS[toolName] || Wrench
}
