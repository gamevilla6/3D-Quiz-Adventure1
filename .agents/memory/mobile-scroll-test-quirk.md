---
name: Mobile browser scroll assertions
description: Observed limitation when testing sticky quiz controls in the mobile Chromium suite.
---

When validating sticky quiz HUD behavior in the mobile browser suite, do not assume `window.scrollTo()` reaches the requested offset. In this project’s mobile test context, the page remained near its initial scroll increment even with an artificially tall question card and extended waits. Prefer assertions about sticky positioning, initial non-overlap, and actual measured viewport bounds; if deep scrolling is essential, first confirm the observed scroll position or use a verified touch-scroll interaction.

**Why:** Programmatic scrolling did not reach its requested distance in the mobile browser harness, causing a test assertion to misdiagnose the sticky layout.

**How to apply:** Check actual `scrollY` after any automated scroll before using it to validate HUD pinning; do not base the assertion only on the requested target.
