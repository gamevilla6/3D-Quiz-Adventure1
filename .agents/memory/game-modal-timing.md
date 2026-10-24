---
name: Modal timing and local reset decisions
description: Fair-play timing and the intended boundary of a Reset Progress action.
---

Opening a modal during an active question suspends countdown callbacks but does not grant extra answering time. Keep the original real-time deadline, and submit an expired question once when the modal closes.

**Why:** The user requires timers to be cleaned up while modals are open, but allowing unlimited modal-based pauses would undermine the paid Time Freeze lifeline and fair-play rules.

**How to apply:** Separate countdown initialization from resuming an existing countdown. Locale changes, modal closes and restored pages must not restart a question's allotted time. Preserve the same eliminated answers after 50/50 across locale changes; rerandomizing them would expose the correct answer by comparison.

Reset Progress removes game stats, coins, unlocks and rewards only after explicit confirmation. Preserve language, audio and performance preferences, and never clear unrelated same-origin storage.

**Why:** Restarting a game journey is different from erasing device preferences or data owned by another artifact. Other open game tabs must not restore old progress after a confirmed reset.

**How to apply:** Keep the warning accurate about what is removed and retained, coordinate a successful reset with other open tabs, and report blocked storage instead of pretending a reset succeeded.
