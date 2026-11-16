import type { DeckNode, Id } from '@shared/types'
import { findDeck, flattenDecks } from '@renderer/lib/decks'

/** Ids of a deck and all its descendants. */
export function subtreeIds(node: DeckNode): Set<Id> {
  return new Set(flattenDecks([node]).map((d) => d.id))
}

/** True if `target` is a valid new parent for `deck` (null = top level). */
export function canMoveTo(tree: DeckNode[], deck: DeckNode, target: Id | null): boolean {
  if (target === deck.id) return false
  if ((deck.parentId ?? null) === target) return false
  if (target && subtreeIds(deck).has(target)) return false
  return target === null || !!findDeck(tree, target)
}

/**
 * Create decks for a name that may contain "::" separators, reusing existing children by name.
 * Returns the id of the deepest deck. Expands collapsed ancestors that are reused.
 */
export async function createDeckPath(tree: DeckNode[], input: string, parentId: Id | null): Promise<Id | null> {
  const parts = input
    .split('::')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  let siblings: DeckNode[] = parentId ? (findDeck(tree, parentId)?.children ?? []) : tree
  let cur: Id | null = parentId
  if (parentId) {
    const p = findDeck(tree, parentId)
    if (p?.collapsed) await window.api.setDeckCollapsed(p.id, false)
  }
  for (const part of parts) {
    const existing = siblings.find((d) => d.name.toLowerCase() === part.toLowerCase())
    if (existing) {
      if (existing.collapsed && existing.children.length > 0) await window.api.setDeckCollapsed(existing.id, false)
      cur = existing.id
      siblings = existing.children
    } else {
      const d = await window.api.createDeck(part, cur)
      cur = d.id
      siblings = []
    }
  }
  return cur
}
