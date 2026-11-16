import { useRef, useState } from 'react'
import type { DeckNode, Id } from '@shared/types'
import { Button, Dialog } from '@renderer/components/ui'
import { DeckCombobox } from '@renderer/features/editor/DeckCombobox'
import { TagInput } from '@renderer/features/editor/TagInput'

export function MoveDialog({
  open,
  onOpenChange,
  tree,
  count,
  onMove
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  tree: DeckNode[]
  count: number
  onMove: (deckId: Id) => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<Id | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Move to deck"
      description={`Move ${count} selected ${count === 1 ? 'card' : 'cards'} (with their reverse cards) to:`}
      initialFocus={ref}
      className="min-h-[24rem]"
    >
      <div className="mt-4">
        <DeckCombobox
          tree={tree}
          value={value}
          onChange={(id) => {
            setValue(id)
            if (id) onMove(id)
          }}
          inputRef={ref}
          placeholder="Choose a deck"
          label="Target deck"
        />
      </div>
    </Dialog>
  )
}

export function TagsDialog({
  open,
  onOpenChange,
  suggestions,
  count,
  onAdd
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  suggestions: string[]
  count: number
  onAdd: (tags: string[]) => void
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>([])
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTags([])
        onOpenChange(o)
      }}
      title="Add tags"
      description={`Add tags to ${count} selected ${count === 1 ? 'card' : 'cards'}. Type a tag and press Space or Enter.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={tags.length === 0}
            onClick={() => {
              onAdd(tags)
              setTags([])
            }}
          >
            Add tags
          </Button>
        </>
      }
      className="min-h-[18rem]"
    >
      <div className="mt-4">
        <TagInput tags={tags} onChange={setTags} suggestions={suggestions} label="Tags" />
      </div>
    </Dialog>
  )
}
