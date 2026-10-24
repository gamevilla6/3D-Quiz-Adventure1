---
name: Minimal active quiz screen
description: Product constraint for the in-round QuizVerse 3D interface.
---

During active play, show only the sticky timer/lifeline/coin HUD, the current question, and its answer choices. Keep navigation, progress counters, score tickers, and transient popups off the visible quiz screen. Reveal the selected/correct answer briefly, then advance automatically; preserve score, rewards, lifeline limits, timer, and anti-cheat state in the underlying game logic.

**Why:** The user explicitly requested an ultra-streamlined round interface containing only those core elements.

**How to apply:** Keep new gameplay controls within the existing HUD or question/answer area; place collection, language, navigation, and detailed score information on the surrounding screens.
