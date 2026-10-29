import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useReaderStateScope } from "../../surface/reader-state";

/** Bodies rendered together in one interruptible background render. */
const BATCH = 3;
/** Bodies this close to the window mount before the page first paints. */
const VIEW_MARGIN = 200;
const HEIGHT_SLOT = "layout.height";

/** How far an element is outside the window; hidden elements are farthest. */
function distanceFromView(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return Infinity;
  if (box.bottom < 0) return -box.bottom;
  if (box.top > window.innerHeight) return box.top - window.innerHeight;
  return 0;
}

/**
 * Mounts the component bodies of a page a few at a time, so opening a long
 * page shows it at once and never holds the main thread. Bodies in view mount
 * before the first paint; the rest follow in small transitions, those within
 * a window's height of the view first and then in page order, each batch
 * after the previous one commits. React renders a transition in short slices
 * and lets input through. Only App page views provide a queue; exports,
 * previews and thumbnails render every body at once.
 */
export class MountQueue {
  private waiting = new Map<HTMLElement, () => void>();
  /** Bodies of the current batch that have not committed yet. */
  private rendering = new Set<HTMLElement>();
  private timer = 0;
  request(element: HTMLElement, mount: () => void) {
    this.waiting.set(element, mount);
    this.schedule();
    // Released when the body commits or the placeholder goes away; the next
    // batch follows once the current one has committed.
    return () => {
      this.waiting.delete(element);
      if (this.rendering.delete(element) && !this.rendering.size)
        this.schedule();
    };
  }
  /** Mounts every waiting body now, for printing. */
  flush() {
    const mounts = [...this.waiting.values()];
    this.waiting.clear();
    flushSync(() => mounts.forEach((mount) => mount()));
  }
  dispose() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.waiting.clear();
    this.rendering.clear();
  }
  private schedule() {
    if (!this.timer && !this.rendering.size && this.waiting.size)
      this.timer = window.setTimeout(this.run, 0);
  }
  private run = () => {
    this.timer = 0;
    // One layout read per batch: the frame computes this layout anyway.
    const order = [...this.waiting.keys()];
    const near = order.filter(
      (element) => distanceFromView(element) <= window.innerHeight,
    );
    const batch = [...new Set([...near, ...order])].slice(0, BATCH);
    const mounts = batch.map((element) => this.waiting.get(element)!);
    for (const element of batch) {
      this.waiting.delete(element);
      this.rendering.add(element);
    }
    startTransition(() => mounts.forEach((mount) => mount()));
  };
}

export const MountQueueContext = createContext<MountQueue | null>(null);

/**
 * Whether a component body may render yet, the element its placeholder
 * attaches to, and the placeholder height: the body's height on this
 * device's last visit, when known.
 */
export function useQueuedMount() {
  const queue = useContext(MountQueueContext);
  const reader = useReaderStateScope();
  const [mounted, setMounted] = useState(!queue);
  const placeholder = useRef<HTMLDivElement>(null);
  // The body is measured through its parent, less what else the parent holds.
  const measured = useRef<{
    parent: HTMLElement;
    chrome: number;
    baseline: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = placeholder.current;
    if (mounted || !queue || !element) return;
    const parent = element.parentElement;
    if (parent) {
      const baseline = parent.offsetHeight;
      measured.current = {
        parent,
        baseline,
        chrome: baseline - element.offsetHeight,
      };
    }
    if (distanceFromView(element) <= VIEW_MARGIN) {
      setMounted(true);
      return;
    }
    // The body's commit replaces the placeholder and releases the request.
    return queue.request(element, () => setMounted(true));
  }, [mounted, queue]);
  // A body that mounts above the reader's view grows without moving what they
  // read. While the page restores its scroll position, the restore places it.
  useLayoutEffect(() => {
    const target = measured.current;
    if (!mounted || !target?.parent.isConnected) return;
    const scroller = target.parent.closest<HTMLElement>(".container-page");
    if (!scroller || scroller.dataset.restoringScroll) return;
    const top = target.parent.getBoundingClientRect().top;
    if (top + target.baseline <= scroller.getBoundingClientRect().top)
      scroller.scrollTop += target.parent.offsetHeight - target.baseline;
  }, [mounted]);
  useEffect(() => {
    const target = measured.current;
    if (!mounted || !target || !reader?.block) return;
    const { store, page, block } = reader;
    const observer = new ResizeObserver(() => {
      const height = target.parent.offsetHeight - target.chrome;
      if (target.parent.offsetHeight && height > 0)
        store.write(page, block, HEIGHT_SLOT, Math.round(height));
    });
    observer.observe(target.parent);
    return () => observer.disconnect();
  }, [mounted, reader]);
  const saved = reader?.block
    ? reader.store.read(reader.page, reader.block, HEIGHT_SLOT)
    : undefined;
  return {
    mounted,
    placeholder,
    height: typeof saved === "number" && saved > 0 ? saved : undefined,
  };
}
