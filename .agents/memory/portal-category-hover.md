---
name: Portal category hover behavior
description: Interaction rule for the orbiting quiz categories.
---

On the portal home screen, orbital category cards can lie between the pointer and the primary start action. Hovering a card should not silently change the selected mode as the player moves toward the action.

**Why:** Pointer travel through the orbital layout switched the chosen category before the start button was clicked, causing the wrong level map to open.

**How to apply:** Use hover to highlight a card or 3D node. Change the selected category on explicit click/tap or keyboard focus. Keep direct 3D hit testing inside the visible portal area and ignore interactive DOM controls.
