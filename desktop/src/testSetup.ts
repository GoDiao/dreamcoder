import { createElement, type ComponentType, type ReactNode } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import { toast } from 'sonner'
import { TooltipProvider } from './components/shared/ui/tooltip'

type WrapperOption = { wrapper?: ComponentType<{ children: ReactNode }> }

function withTooltipProvider<T extends WrapperOption>(options?: T): T {
  const Inner = options?.wrapper
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(TooltipProvider, { delayDuration: 400, children: Inner ? createElement(Inner, { children }) : children })
  return Object.assign({}, options, { wrapper: Wrapper })
}

vi.mock('@testing-library/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@testing-library/react')>()
  return {
    ...actual,
    render: (ui: Parameters<typeof actual.render>[0], options?: Parameters<typeof actual.render>[1]) =>
      actual.render(ui, withTooltipProvider(options)),
    renderHook: (callback: Parameters<typeof actual.renderHook>[0], options?: Parameters<typeof actual.renderHook>[1]) =>
      actual.renderHook(callback, withTooltipProvider(options)),
  }
})

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()
  const spied = Object.assign((...args: Parameters<typeof actual.toast>) => actual.toast(...args), actual.toast, {
    success: vi.fn(actual.toast.success),
    error: vi.fn(actual.toast.error),
    warning: vi.fn(actual.toast.warning),
    info: vi.fn(actual.toast.info),
  })
  return { ...actual, toast: spied }
})

const toastTypes = ['success', 'error', 'warning', 'info'] as const

const intersectionObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
const replaceSync = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'replaceSync')
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const resizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')

beforeEach(() => {
  if (!globalThis.IntersectionObserver) Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: class {
      targets = new Set<Element>()
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target)
        queueMicrotask(() => {
          if (this.targets.has(target)) this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
        })
      }
      unobserve(target: Element) { this.targets.delete(target) }
      disconnect() { this.targets.clear() }
    },
  })
  if (!CSSStyleSheet.prototype.replaceSync) Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', { configurable: true, writable: true, value: vi.fn() })
  if (!Element.prototype.scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  if (globalThis.ResizeObserver) return
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  })
})

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown'))
  for (const type of toastTypes) vi.mocked(toast[type]).mockClear()
  toast.dismiss()
  if (intersectionObserver) Object.defineProperty(globalThis, 'IntersectionObserver', intersectionObserver)
  else Reflect.deleteProperty(globalThis, 'IntersectionObserver')
  if (replaceSync) Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', replaceSync)
  else Reflect.deleteProperty(CSSStyleSheet.prototype, 'replaceSync')
  if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  if (resizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', resizeObserver)
  else Reflect.deleteProperty(globalThis, 'ResizeObserver')
})
