---
name: Round resume snapshots
description: Constraints for preserving an active randomized quiz round when navigating away and resuming it.
---

Persist the actual ten questions in the active round, not just their pool indexes. Randomly generated pools—especially IQ questions—can differ when regenerated, so indexes alone may point to different content after resume. Preserve the exact eliminated options, lifelines already spent, score state, and remaining countdown/freeze time.

**Why:** Leaving gameplay stops and resets timer callbacks; capturing the deadline and freeze state after cleanup can grant or remove time. Regenerating a randomized pool can also change the question or answer associated with a saved index.

**How to apply:** Before any navigation out of an active round, snapshot gameplay state and remaining time, then stop callbacks. Validate storage on restore and rebuild the concealed answer mapping for the saved question objects. Resume with one timer only; clear the snapshot when the round completes or a different round starts.
