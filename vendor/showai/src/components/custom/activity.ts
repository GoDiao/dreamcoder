/** Private host lifecycle: retain iframe state while pausing animation work. */
export function installComponentActivity(channel: string) {
  let active = true;
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const interval = window.setInterval.bind(window);
  const frames = new Map<
    number,
    { callback: FrameRequestCallback; native: number | null }
  >();
  const schedule = (id: number) => {
    const frame = frames.get(id);
    if (!frame) return;
    frame.native = request((time) => {
      frame.native = null;
      if (!active) return;
      frames.delete(id);
      frame.callback(time);
    });
  };
  window.requestAnimationFrame = (callback) => {
    let id = 0;
    const native = request((time) => {
      const frame = frames.get(id);
      if (!frame) return;
      frame.native = null;
      if (!active) return;
      frames.delete(id);
      callback(time);
    });
    id = native;
    frames.set(id, { callback, native: active ? native : null });
    if (!active) cancel(native);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const frame = frames.get(id);
    if (frame?.native !== null && frame?.native !== undefined)
      cancel(frame.native);
    else cancel(id);
    frames.delete(id);
  };
  window.setInterval = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) =>
    typeof handler === "function"
      ? interval(() => {
          if (active) handler.apply(window, args);
        }, timeout)
      : interval(handler, timeout, ...args)) as typeof window.setInterval;
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      event.data?.channel !== channel ||
      event.data?.type !== "showai:activity" ||
      typeof event.data.active !== "boolean"
    )
      return;
    if (active === event.data.active) return;
    active = event.data.active;
    for (const [id, frame] of frames) {
      if (!active && frame.native !== null) {
        cancel(frame.native);
        frame.native = null;
      } else if (active && frame.native === null) schedule(id);
    }
  });
}
