import { createContext, useContext, useEffect, useState } from "react";
import type { PortableInkV2 } from "./portable-ink.mjs";
import { preparedCubicGeometry } from "./portable-cubic-client.mjs";
import { PortableInputScope } from "./portable-input-scope";
export const PortableCubicContext = createContext<
  PortableInputScope | undefined
>(undefined);
export function usePreparedCubic(
  ink: PortableInkV2 | undefined,
  width: number,
  pressure: boolean,
  native: boolean,
) {
  const scope = useContext(PortableCubicContext),
    [, refresh] = useState(0);
  // Transport capability only chooses where preparation runs. Actual
  // actions.nativeScene still decides whether DOM paint exists at all.
  const nativeTransport =
    typeof window !== "undefined" && !!window.showai?.inlineInk?.nativeScene;
  const ready =
    !ink ||
    native ||
    nativeTransport ||
    !scope ||
    !!preparedCubicGeometry(ink, width, pressure);
  const [failure, setFailure] = useState<unknown>();
  useEffect(() => {
    if (!ink || native || nativeTransport || !scope || ready) return;
    let active = true;
    void scope.client.prepare(ink, width, pressure).then(
      () => {
        if (active) refresh((v) => v + 1);
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [ink, width, pressure, scope, native, nativeTransport, ready]);
  if (failure) throw failure;
  // Hold the actual derived object while this reader is mounted. The shared LRU
  // may release its strong reference, but never forces an active reader to refit.
  const held =
    ink && ready ? preparedCubicGeometry(ink, width, pressure) : undefined;
  return { ready, held };
}
