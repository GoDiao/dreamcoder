import type { ReactNode, Ref } from 'react'
import type { DOMElement } from './dom.js'
import type { EventHandlerProps } from './events/event-handlers.js'
import type { Styles, TextStyles } from './styles.js'

type InkElementProps = {
  children?: ReactNode
  ref?: Ref<DOMElement>
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': InkElementProps &
        EventHandlerProps & {
          style?: Styles
          tabIndex?: number
          autoFocus?: boolean
          stickyScroll?: boolean
        }
      'ink-text': InkElementProps & {
        style?: Styles
        textStyles?: TextStyles
      }
      'ink-link': InkElementProps & {
        href?: string
      }
      'ink-raw-ansi': InkElementProps & {
        rawText: string
        rawWidth: number
        rawHeight: number
      }
    }
  }
}
