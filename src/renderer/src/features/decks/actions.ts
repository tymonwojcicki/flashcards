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
