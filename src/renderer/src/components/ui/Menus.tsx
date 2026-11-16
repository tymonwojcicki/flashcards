import type { ReactNode } from 'react'
import clsx from 'clsx'
import * as DM from '@radix-ui/react-dropdown-menu'
import * as CM from '@radix-ui/react-context-menu'
import { Kbd } from './Kbd'

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hotkey?: string; disabled?: boolean; description?: string }
  | { type: 'separator' }

const CONTENT = 'anim-menu-in neu-raised z-[80] min-w-[12rem] rounded-2xl p-1.5'
const ITEM =
  'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

function itemClass(danger?: boolean): string {
  return clsx(
    ITEM,
    danger
      ? 'text-danger data-[highlighted]:bg-danger/12'
      : 'text-text data-[highlighted]:bg-accent/12 data-[highlighted]:text-accent'
  )
}

function ItemText({ it }: { it: Extract<MenuEntry, { type?: 'item' }> }): React.JSX.Element {
  if (!it.description) return <span className="flex-1">{it.label}</span>
  return (
    <span className="flex flex-1 flex-col">
      <span>{it.label}</span>
      <span className="text-xs font-normal text-muted">{it.description}</span>
    </span>
  )
}

export interface DropdownMenuProps {
  /** The trigger element (rendered asChild). */
  trigger: React.ReactElement
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
}

export function DropdownMenu({ trigger, items, align = 'end' }: DropdownMenuProps): React.JSX.Element {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={8} className={CONTENT}>
          {items.map((it, i) =>
            it.type === 'separator' ? (
              <DM.Separator key={i} className="my-1.5 h-px bg-muted/25" />
            ) : (
              <DM.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={itemClass(it.danger)}>
                {it.icon}
                <ItemText it={it} />
                {it.hotkey && <Kbd hotkey={it.hotkey} />}
              </DM.Item>
            )
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

export interface ContextMenuProps {
  /** The area that opens the menu on right-click (rendered asChild). */
  children: React.ReactElement
  items: MenuEntry[]
}

export function ContextMenu({ children, items }: ContextMenuProps): React.JSX.Element {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={CONTENT}>
          {items.map((it, i) =>
            it.type === 'separator' ? (
              <CM.Separator key={i} className="my-1.5 h-px bg-muted/25" />
            ) : (
              <CM.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={itemClass(it.danger)}>
                {it.icon}
                <ItemText it={it} />
                {it.hotkey && <Kbd hotkey={it.hotkey} />}
              </CM.Item>
            )
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}
