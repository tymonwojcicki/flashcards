import type { DeckNode } from '@shared/types'

/** Depth-first flat list of every deck in the tree. */
export function flattenDecks(tree: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = []
  const walk = (nodes: DeckNode[]): void => {
    for (const n of nodes) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(tree)
  return out
}

export function findDeck(tree: DeckNode[], id: string | null | undefined): DeckNode | null {
  if (!id) return null
  return flattenDecks(tree).find((d) => d.id === id) ?? null
}

/** New + learning + review count of a deck (subtree). */
export function dueTotal(d: DeckNode): number {
  return d.counts.new + d.counts.learning + d.counts.review
}
