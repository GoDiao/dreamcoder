import { captureOwnedJSON } from "../portable/owned-json.mjs";
import {
  createPortableCubicClient,
  type PortableCubicClient,
} from "./portable-cubic-client.mjs";
import type {
  CubicInputOptions,
  CubicInputBatch,
  CubicPaintDelta,
  CubicPaintChunk,
  CubicSealedStroke,
} from "./portable-cubic-worker-model";
import type { OwnedSourceSession } from "./source-client";

const owners = new WeakMap<OwnedSourceSession, Set<PortableInputScope>>();
export async function flushPortableInputs(
  owner: OwnedSourceSession | undefined,
  finishActive: boolean,
) {
  if (!owner) return;
  const scopes = [...(owners.get(owner) ?? [])];
  await Promise.all(scopes.map((scope) => scope.flush(finishActive)));
}
export function portableInputsPending(owner: OwnedSourceSession | undefined) {
  return (
    !!owner && [...(owners.get(owner) ?? [])].some((scope) => scope.hasContacts)
  );
}
export function stopPortableInputs(owner: OwnedSourceSession | undefined) {
  if (owner) for (const scope of owners.get(owner) ?? []) scope.stop();
}
export interface PortableInputAcceptance {
  complete(value: CubicSealedStroke): Promise<void>;
  fail(error: unknown): void;
}
export type PortableInputReservation = (
  options: CubicInputOptions,
) => PortableInputAcceptance;
/** The accepted-contact barrier is independent of mounted input tools. Tool
 * switches can seal a contact, but cannot retire already accepted raw input. */
export class PortableInputScope {
  private clientValue: PortableCubicClient | undefined;
  private contacts = new Set<PortableInputContact>();
  private pending = new Set<Promise<void>>();
  private acceptanceTail: Promise<void> = Promise.resolve();
  private acceptanceOrder = new WeakMap<PortableInputContact, number>();
  private serial = 0;
  private failures = new Map<PortableInputContact, unknown>();
  private retired = false;
  private accepting = true;
  stop() {
    this.accepting = false;
  }
  private displays = new Map<
    string,
    { options: CubicInputOptions; chunks: CubicPaintChunk[] }
  >();
  private listeners = new Set<() => void>();
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  previews(boardId: string) {
    return [...this.displays.values()].filter(
      (value) => value.options.boardId === boardId,
    );
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  private acceptances = new WeakMap<
    PortableInputContact,
    PortableInputAcceptance
  >();
  constructor(
    private reserve: PortableInputReservation,
    readonly owner?: OwnedSourceSession,
  ) {
    if (owner) {
      let scopes = owners.get(owner);
      if (!scopes) {
        scopes = new Set();
        owners.set(owner, scopes);
      }
      scopes.add(this);
    }
  }
  error(boardId: string) {
    return [...this.failures].find(
      ([contact]) => contact.options.boardId === boardId,
    )?.[1];
  }
  get hasContacts() {
    return this.contacts.size > 0;
  }
  get client() {
    if (this.retired) throw new Error("Portable input owner is retired");
    return (this.clientValue ??= createPortableCubicClient());
  }
  begin(
    options: CubicInputOptions,
    batch: CubicInputBatch,
    paint?: (value: CubicPaintDelta) => void,
  ) {
    if (!this.accepting) throw new Error("Portable input owner is retiring");
    options = captureOwnedJSON(options);
    batch = captureOwnedJSON(batch);
    this.displays.set(options.strokeId, { options, chunks: [] });
    const contact = new PortableInputContact(this, options, batch, (value) => {
      const display = this.displays.get(options.strokeId);
      if (!display) return;
      display.chunks.length = value.firstChunk;
      for (const chunk of value.chunks) display.chunks.push(chunk);
      if (display.chunks.length !== value.chunkCount)
        throw new Error(
          "Cubic preview suffix does not match its retained prefix",
        );
      paint?.(value);
      this.notify();
    });
    this.contacts.add(contact);
    this.notify();
    return contact;
  }
  cancel(contact: PortableInputContact) {
    this.contacts.delete(contact);
    this.displays.delete(contact.options.strokeId);
    this.notify();
  }
  accepted(contact: PortableInputContact) {
    if (!this.acceptanceOrder.has(contact))
      this.acceptanceOrder.set(contact, ++this.serial);
    let acceptance = this.acceptances.get(contact),
      reservationError: unknown;
    if (!acceptance) {
      try {
        acceptance = this.reserve(contact.options);
        this.acceptances.set(contact, acceptance);
      } catch (error) {
        reservationError = error;
      }
    }
    const accepted = acceptance;
    const predecessor = this.acceptanceTail;
    const produced = reservationError
      ? Promise.reject(reservationError)
      : contact.finished();
    const task = produced
      .then((value) => predecessor.then(() => accepted!.complete(value)))
      .then(() => {
        this.failures.delete(contact);
        this.contacts.delete(contact);
        this.displays.delete(contact.options.strokeId);
        this.notify();
      })
      .catch((error) => {
        this.failures.set(contact, error);
        accepted?.fail(error);
        this.notify();
        throw error;
      })
      .finally(() => this.pending.delete(task));
    this.acceptanceTail = task;
    this.pending.add(task);
    void task.catch(() => {});
    return task;
  }
  async flush(finishActive: boolean) {
    if (finishActive) for (const contact of this.contacts) contact.finish();
    await Promise.all([...this.pending]);
    if (this.failures.size) throw this.failures.values().next().value;
  }
  async retry() {
    if (!this.failures.size) return;
    for (const contact of this.contacts) contact.finish();
    await Promise.allSettled([
      ...this.pending,
      ...[...this.contacts].map((contact) => contact.idle()),
    ]);
    await this.owner?.retryRegistration();
    this.client.restart();
    this.acceptanceTail = Promise.resolve();
    const failed = [...this.failures.keys()].sort(
      (a, b) => this.acceptanceOrder.get(a)! - this.acceptanceOrder.get(b)!,
    );
    this.failures.clear();
    this.notify();
    // Replays exact original kernel batches, not a resampled v1 placeholder.
    for (const contact of failed) {
      contact.replay();
      await this.accepted(contact);
    }
  }
  async close() {
    this.stop();
    await this.flush(true);
    this.retired = true;
    this.clientValue?.close();
    if (this.owner) {
      const scopes = owners.get(this.owner);
      scopes?.delete(this);
      if (!scopes?.size) owners.delete(this.owner);
    }
  }
}
export class PortableInputContact {
  private batches: CubicInputBatch[];
  private sent = 1;
  private running: Promise<void>;
  private ending = false;
  private result: Promise<CubicSealedStroke> | undefined;
  private paintGeneration = 0;
  constructor(
    private scope: PortableInputScope,
    readonly options: CubicInputOptions,
    batch: CubicInputBatch,
    private paint: (value: CubicPaintDelta) => void,
  ) {
    this.batches = [batch];
    this.running = this.scope.client
      .begin(options, batch)
      .then((value) => this.painted(value.paint));
    void this.running.catch(() => {});
  }
  private painted(value: CubicPaintDelta | undefined) {
    if (!value) return;
    if (
      value.strokeId !== this.options.strokeId ||
      value.baseGeneration !== this.paintGeneration ||
      value.generation <= this.paintGeneration
    )
      throw new Error("Cubic changed suffix is out of sequence");
    this.paintGeneration = value.generation;
    this.paint(value);
  }
  push(batch: CubicInputBatch) {
    if (this.ending) return;
    this.batches.push(captureOwnedJSON(batch));
    this.pump();
  }
  private pump() {
    this.running = this.running.then(async () => {
      if (this.ending || this.sent === this.batches.length) return;
      const batches = this.batches.slice(this.sent);
      this.sent = this.batches.length;
      const value = await this.scope.client.push(
        this.options.strokeId,
        batches,
      );
      this.painted(value.paint);
    });
    void this.running.catch(() => {});
  }
  idle() {
    return this.running;
  }
  cancel() {
    if (this.ending) return;
    this.ending = true;
    this.scope.cancel(this);
    void this.running
      .then(() => this.scope.client.release(this.options.strokeId))
      .catch((error) =>
        console.error("Cancelled cubic contact release failed", error),
      );
  }
  finish() {
    if (this.ending) return;
    this.ending = true;
    this.scope.accepted(this);
  }
  finished() {
    return (this.result ??= this.running.then(async () => {
      const value = await this.scope.client.seal(
        this.options.strokeId,
        this.batches.slice(this.sent),
      );
      this.painted(value.paint);
      if (!value.sealed)
        throw new Error("Cubic input owner did not export its sealed source");
      await this.scope.client.release(this.options.strokeId);
      return value.sealed;
    }));
  }
  replay() {
    this.sent = 1;
    this.paintGeneration = 0;
    this.result = undefined;
    this.running = this.scope.client
      .begin(this.options, this.batches[0])
      .then((value) => this.painted(value.paint));
  }
}
