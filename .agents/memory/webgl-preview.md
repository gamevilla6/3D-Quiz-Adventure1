---
name: WebGL preview limitation
description: The screenshot browser may not provide WebGL2 for the Three.js game preview.
---

The Replit app-preview screenshot browser reported WebGL2 unavailable for this game, so screenshots displayed its CSS fallback instead of the procedural Three.js scene.

**Why:** The preview renderer can lack the graphics capability required by the app, independently of whether the app's 3D code is valid.

**How to apply:** When verifying visual changes, distinguish this preview limitation from a game runtime defect. Keep the accessible fallback, and verify Three.js changes with syntax/build checks and a browser that supports WebGL2 rather than removing the 3D path to satisfy screenshots.
