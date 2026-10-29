export type SurfaceKind = "page" | "board";
export type PageWidthMode = "standard" | "wide" | "full";
export type DrawingTool =
  "pen" | "highlighter" | "rectangle" | "ellipse" | "arrow";
export type BoardDrawingTool = DrawingTool | "region";
/** Board modes: drawing tools plus navigation, erasing, lasso and text placement. */
export type BoardTool = BoardDrawingTool | "pan" | "eraser" | "lasso" | "text";
export interface DrawingStyle {
  color: string;
  fillColor: string;
  strokeWidth: number;
  pressure?: boolean;
  /** Label font size for rectangles, ellipses and arrows, in Board units. */
  labelSize?: number;
}
export type LayoutMode = "flow" | "grid" | "free";
export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height?: number;
  rotation?: number;
  /** Last measured content dimensions; never imposes a CSS height. */
  contentSize?: { width: number; height: number };
  heightMode?: "fixed" | "auto";
  mode?: LayoutMode;
  columns?: number;
  gap?: number;
  /** Protects the frame from pointer moves and resizes in the editor. */
  locked?: true;
}
export interface SavedView {
  id: string;
  name: string;
  targets: string[];
}
export interface PageViews {
  initial: string | null;
  saved: SavedView[];
  readingOrder: string[];
}
