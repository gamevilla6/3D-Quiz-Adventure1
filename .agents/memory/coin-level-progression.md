---
name: Forgiving coin progression
description: Persistent progression and coin-unlock rules for QuizVerse 3D.
---

A 10-question level passes with at least six correct answers. Players can also unlock a later level for 100 coins per progression step advanced; the unlock action must show total cost and current balance before spending. Persist coin deductions and the new unlock marker to local storage, and keep coin-skipped stages marked playable rather than completed until the player actually clears them.

**Why:** The user requested a forgiving level curve and a paid alternative to getting stuck, while keeping rewards and completion records honest.

**How to apply:** Keep the six-of-ten threshold consistent in pass/fail, result copy, and tests. When changing coin unlock pricing or progression, preserve per-category unlocks and distinguish purchased access from earned completion. Client-side local storage is not tamper-proof; competitive validation requires server authority.
