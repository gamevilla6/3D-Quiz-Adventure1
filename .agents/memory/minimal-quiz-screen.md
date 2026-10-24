---
name: Minimal active quiz screen
description: Product constraint for the in-round QuizVerse 3D interface.
---

During active play, show only the sticky timer/lifeline/coin HUD, the current question, and its answer choices. Keep navigation, progress counters, score tickers, and transient popups off the visible quiz screen. Reveal the selected/correct answer briefly, then advance automatically; preserve score, rewards, lifeline limits, timer, and anti-cheat state in the underlying game logic.

After a round, keep the result card focused on correct and incorrect counts, accuracy, net score, stars, total coins earned, and exactly two actions: next/retry and return to the level map. Explain the score rule compactly, persist coins and progression before showing results, and keep both mobile actions at least 50px high without overlapping the top bar.

**Why:** The user explicitly requested an ultra-streamlined round interface and a clean, mathematically understandable result screen.

**How to apply:** Keep new gameplay controls within the existing HUD or question/answer area; place collection, language, navigation, and detailed score information on the surrounding screens. Keep result-screen additions to the requested summary and actions, and verify the header/card geometry at narrow phone widths.
