# Flashcards

A spaced-repetition app: notes become cards, cards are scheduled across study days, and each deck offers a queue of cards to study today.

## Language

### Content

**Note**:
The thing the user writes: a front, a back, tags and a deck.
_Avoid_: Fact, entry

**Card**:
One direction (forward or reverse) of a note, scheduled on its own.
_Avoid_: Item, question

**Sibling**:
Another card of the same note.

### Scheduling

**Study day**:
The day as the user studies it, starting at the configured day-start hour rather than midnight.
_Avoid_: Calendar day, date

**Due**:
A learning, relearning or review card whose scheduled time falls before the end of the current study day, and that is neither suspended nor buried.
_Avoid_: Overdue (for the whole set), pending

**Buried**:
Held back until the next study day. A buried card is never due.

**Bury siblings**:
A preset rule: a deck offers at most one new or review card per note per study day, whatever study mode is used.

**Learn-ahead**:
How far ahead a learning card may be shown early. A learning card outside it is not offered yet, even if it is due later today.
_Avoid_: Look-ahead

**Today's Queue**:
The cards a deck offers for scheduled study now: due learning cards within learn-ahead, due reviews and new cards, after daily limits and bury siblings. Deck counts are its size.
_Avoid_: Due list, daily queue

**Study session**:
One run of studying a deck in one study mode: its cards, answers, undo and waiting for learning cards. In code, `StudySession` is the cards a session starts with and `StudySessionRunner` runs it.

**Study mode**:
How a study session picks cards. Mixed, Review only and Learn new draw from Today's Queue and affect scheduling. Cram and Weak spots do neither.

### Storage

**Data folder**:
Where a collection lives: a folder on disk (often synced) or the browser's own storage. Only a folder has a lock, backups and conflict copies.

**Lock**:
A file in the data folder naming the device that is writing to it. Another device opens the folder read-only, or presses "Open anyway" to take the lock over.

**Data Folder Session**:
The module that owns a data folder while the app has it open: the collection, the lock and its heartbeat, backups, conflict copies, restore and switching folder.
