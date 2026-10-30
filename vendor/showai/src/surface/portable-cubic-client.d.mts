import type { PortableInkV2 } from "./portable-ink.mjs";
import type {
  CubicInputOptions,
  CubicInputBatch,
  CubicInputResponse,
} from "./portable-cubic-worker-model";
import type { cubicInkGeometry } from "./cubic-ink-core.mjs";
export class CubicWorkerFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
export function preparedCubicGeometry(
  ink: PortableInkV2,
  width?: number,
  pressure?: boolean,
): ReturnType<typeof cubicInkGeometry> | undefined;
export interface PortableCubicClient {
  ready(): Promise<CubicInputResponse>;
  begin(
    options: CubicInputOptions,
    batch: CubicInputBatch,
  ): Promise<CubicInputResponse>;
  push(
    strokeId: string,
    batches: CubicInputBatch[],
  ): Promise<CubicInputResponse>;
  seal(
    strokeId: string,
    batches: CubicInputBatch[],
  ): Promise<CubicInputResponse>;
  release(strokeId: string): Promise<CubicInputResponse>;
  prepare(
    ink: PortableInkV2,
    width?: number,
    pressure?: boolean,
  ): Promise<ReturnType<typeof cubicInkGeometry>>;
  onFailure(listener: (error: Error) => void): () => void;
  restart(): void;
  close(): void;
}
export function createPortableCubicClient(): PortableCubicClient;

export function chargePreparedCubicQuery(
  geometry: object,
  query: { polygons: { length: number }[] },
): void;
