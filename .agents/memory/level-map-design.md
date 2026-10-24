---
name: Full-scroll level roadmap
description: Product constraint for the QuizVerse 3D level-selection screen.
---

Show all 500 levels for the selected category together in one responsive, touch-scrollable grid; do not paginate the roadmap. Keep the map header compact, retain horizontal category pills and a small back control, and avoid repeated per-node copy. Center the level number and a clear unlocked/completed/locked state marker; completed nodes also show their earned stars and coin reward. Continue treating saved progression tokens as the authority for which levels are playable.

**Why:** The user asked for a clean 500-level roadmap that can be explored by scrolling, without clutter or overlap.

**How to apply:** Preserve the all-level scroll model and category-specific unlock states when updating the map; use mobile layout checks at narrow widths and landscape orientation.
