import * as T from '@radix-ui/react-tooltip'
import { Kbd } from './Kbd'

export interface TooltipProps {
  content: React.ReactNode
  hotkey?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Hover delay in ms before showing (default 400). */
  delay?: number
  children: React.ReactElement
}

/** Wraps a single element (asChild) with a tooltip. */
export function Tooltip({ content, hotkey, side = 'top', delay = 400, children }: TooltipProps): React.JSX.Element {
  return (
    <T.Provider delayDuration={delay} skipDelayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            side={side}
            sideOffset={8}
            className="anim-menu neu-raised-sm z-[90] flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-text"
          >
            {content}
            {hotkey && <Kbd hotkey={hotkey} />}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  )
}
