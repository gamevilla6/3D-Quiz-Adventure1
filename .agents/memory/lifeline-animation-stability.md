---
name: Lifeline animation stability
description: Animation and rerender constraints for touch targets in the QuizVerse lifeline UI.
---

Animate the lifeline panel with glow or opacity rather than moving transforms on its parent; keep interactive hitboxes stationary. Play the 50/50 dissolve only when activated, then apply its hidden-option state immediately when a language change rebuilds the question UI.

**Why:** A continuously moving parent made touch buttons unstable, and replaying the dissolve during a locale rerender briefly exposed eliminated options again.

**How to apply:** Keep idle motion paint-only and have rerenders reconstruct the active lifeline state without replaying activation animations.
