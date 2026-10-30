import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * Personal reading state on this device: the tab, step, branch or parameter a
 * reader left a component on. It is keyed by page document and block, written
 * to localStorage after a short pause, and never enters the Page.
 */
const PREFIX = "showai.reader-state.v1:";
const INDEX_KEY = "showai.reader-state.v1";
const MAX_PAGES = 400;
const MAX_PAGE_BYTES = 256 * 1024;
export const MAX_READER_VALUE_BYTES = 16 * 1024;
const WRITE_DELAY = 800;

type PageState = Record<string, Record<string, unknown>>;
type Listener = (value: unknown) => void;

export class ReaderStateStore {
  private pages = new Map<string, PageState>();
  private dirty = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private delay = WRITE_DELAY,
  ) {}
  private page(page: string) {
    let state = this.pages.get(page);
    if (state) return state;
    state = {};
    const text = this.storage.getItem(PREFIX + page);
    if (text) {
      try {
        const saved = JSON.parse(text);
        if (saved && typeof saved === "object" && !Array.isArray(saved))
          for (const [block, slots] of Object.entries(saved))
            if (slots && typeof slots === "object" && !Array.isArray(slots))
              state[block] = { ...(slots as Record<string, unknown>) };
      } catch (error) {
        console.warn("Reading state could not be read", page, error);
      }
    }
    this.pages.set(page, state);
    return state;
  }
  read(page: string, block: string, slot: string): unknown {
    return this.page(page)[block]?.[slot];
  }
  /** Stores one slot; undefined removes it. Other instances of the slot are told. */
  write(page: string, block: string, slot: string, value: unknown) {
    const state = this.page(page);
    if (value === undefined) {
      if (!state[block] || !(slot in state[block])) return;
      delete state[block][slot];
      if (!Object.keys(state[block]).length) delete state[block];
    } else {
      const text = JSON.stringify(value);
      if (text === undefined || text.length > MAX_READER_VALUE_BYTES) {
        console.warn("Reading state is too large to keep", block, slot);
        return;
      }
      if (JSON.stringify(state[block]?.[slot]) === text) return;
      state[block] = { ...state[block], [slot]: JSON.parse(text) };
    }
    this.dirty.add(page);
    // Told after the current render: a component may reset its state while rendering.
    const listeners = [
      ...(this.listeners.get(slotKey(page, block, slot)) ?? []),
    ];
    if (listeners.length)
      queueMicrotask(() => {
        for (const listener of listeners) listener(value);
      });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }
  subscribe(page: string, block: string, slot: string, listener: Listener) {
    const key = slotKey(page, block, slot);
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(key);
    };
  }
  /** Writes pending pages. Storage is a personal convenience: a full or
   * unavailable one leaves the state in memory and says why. */
  flush() {
    clearTimeout(this.timer);
    if (!this.dirty.size) return;
    try {
      this.persist();
    } catch (error) {
      console.warn("Reading state could not be written", error);
    }
  }
  private persist() {
    const index = this.index();
    const now = Date.now();
    for (const page of this.dirty) {
      const state = this.pages.get(page) ?? {};
      if (!Object.keys(state).length) {
        this.storage.removeItem(PREFIX + page);
        delete index[page];
        continue;
      }
      const text = JSON.stringify(state);
      if (text.length > MAX_PAGE_BYTES) {
        console.warn("Reading state of this page is too large to keep", page);
        continue;
      }
      this.storage.setItem(PREFIX + page, text);
      // Re-adding moves the page last, so equal stamps still keep the newest.
      delete index[page];
      index[page] = now;
    }
    this.dirty.clear();
    const pages = Object.entries(index)
      .reverse()
      .sort(([, a], [, b]) => b - a);
    for (const [page] of pages.slice(MAX_PAGES)) {
      this.storage.removeItem(PREFIX + page);
      this.pages.delete(page);
      delete index[page];
    }
    this.storage.setItem(INDEX_KEY, JSON.stringify(index));
  }
  private index(): Record<string, number> {
    const text = this.storage.getItem(INDEX_KEY);
    if (!text) return {};
    try {
      const saved = JSON.parse(text);
      return Object.fromEntries(
        Object.entries(saved ?? {}).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]),
        ),
      );
    } catch (error) {
      console.warn("Reading state index could not be read", error);
      return {};
    }
  }
}

const slotKey = (page: string, block: string, slot: string) =>
  JSON.stringify([page, block, slot]);

let shared: ReaderStateStore | undefined;
/** The App's store; written on a pause, and before the window goes away. */
export function readerStateStore() {
  if (shared) return shared;
  const store = new ReaderStateStore(localStorage);
  const flush = () => store.flush();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  shared = store;
  return store;
}

/**
 * The page and block whose reading state components below keep. Only App
 * surfaces provide it; exports, previews and thumbnails render without it, so
 * their components start from the saved data every time.
 */
export interface ReaderStateScope {
  page: string;
  block?: string;
  store: ReaderStateStore;
}
export const ReaderStateContext = createContext<ReaderStateScope | null>(null);
export const useReaderStateScope = () => useContext(ReaderStateContext);

/**
 * useState that remembers its value for this reader on this device. `block`
 * names a node with its own id, such as a toggle inside rich text. `accept`
 * rejects a saved value the current data can no longer show; a value equal to
 * the initial one is not stored, so a changed default still reaches readers.
 */
export function useReaderState<T>(
  slot: string,
  initial: T | (() => T),
  options: { block?: string | null; accept?: (value: unknown) => boolean } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const scope = useContext(ReaderStateContext);
  // An explicit id, even null, names the owner; otherwise the enclosing block.
  const block =
    options.block !== undefined ? (options.block ?? undefined) : scope?.block;
  const key = scope && block ? slotKey(scope.page, block, slot) : null;
  const accept = useRef(options.accept);
  accept.current = options.accept;
  const resolve = (): { key: string | null; value: T; base: T } => {
    const base =
      typeof initial === "function" ? (initial as () => T)() : initial;
    if (!scope || !block) return { key, value: base, base };
    const saved = scope.store.read(scope.page, block, slot);
    return {
      key,
      value:
        saved !== undefined && (accept.current?.(saved) ?? true)
          ? (saved as T)
          : base,
      base,
    };
  };
  const [state, setState] = useState(resolve);
  let current = state;
  if (state.key !== key) {
    current = resolve();
    setState(current);
  }
  const latest = useRef({ scope, block, current });
  latest.current = { scope, block, current };
  useEffect(() => {
    if (!scope || !block) return;
    const apply = (value: unknown) => {
      const next =
        value !== undefined && (accept.current?.(value) ?? true)
          ? (value as T)
          : latest.current.current.base;
      setState((previous) =>
        Object.is(previous.value, next)
          ? previous
          : { ...previous, value: next },
      );
    };
    const stop = scope.store.subscribe(scope.page, block, slot, apply);
    // A hidden tab resumes with what another view of the page chose meanwhile.
    apply(scope.store.read(scope.page, block, slot));
    return stop;
  }, [key]);
  const set = useRef<Dispatch<SetStateAction<T>>>(null!);
  set.current = (action) => {
    const { scope, block, current } = latest.current;
    const value =
      typeof action === "function"
        ? (action as (previous: T) => T)(current.value)
        : action;
    if (Object.is(value, current.value)) return;
    latest.current.current = { ...current, value };
    setState((previous) => ({ ...previous, value }));
    if (!scope || !block) return;
    scope.store.write(
      scope.page,
      block,
      slot,
      JSON.stringify(value) === JSON.stringify(current.base)
        ? undefined
        : value,
    );
  };
  const [dispatch] = useState<Dispatch<SetStateAction<T>>>(
    () => (action: SetStateAction<T>) => set.current(action),
  );
  return [current.value, dispatch];
}

/** Gives the components inside one page block their own reading state. */
export function ReaderBlock({
  id,
  children,
}: {
  id: string | null | undefined;
  children: ReactNode;
}) {
  const scope = useContext(ReaderStateContext);
  const value = useMemo(
    () => (scope && id ? { ...scope, block: id } : scope),
    [scope, id],
  );
  return createElement(ReaderStateContext.Provider, { value }, children);
}

export const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
export const isIndexList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => Number.isInteger(item));
export const isText = (value: unknown): value is string =>
  typeof value === "string";
export const isFlag = (value: unknown): value is boolean =>
  typeof value === "boolean";
export const isIndex = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const isNumberRecord = (
  value: unknown,
): value is Record<string, number> =>
  isRecord(value) &&
  Object.values(value).every(
    (item) => typeof item === "number" && Number.isFinite(item),
  );

/** A remembered set of ids, kept as a list. */
export function useReaderSet(
  slot: string,
  initial: () => Iterable<string> = () => [],
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [list, setList] = useReaderState<string[]>(slot, () => [...initial()], {
    accept: isStringList,
  });
  const set = useMemo(() => new Set(list), [list]);
  const latest = useRef(set);
  latest.current = set;
  const [dispatch] = useState<Dispatch<SetStateAction<Set<string>>>>(
    () => (action: SetStateAction<Set<string>>) =>
      setList([
        ...(typeof action === "function" ? action(latest.current) : action),
      ]),
  );
  return [set, dispatch];
}

/** Runs `reset` when `key` changes after mount, so restored state survives the first render. */
export function useResetOnChange(key: string | number, reset: () => void) {
  const previous = useRef(key);
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    latest.current();
  }, [key]);
}
