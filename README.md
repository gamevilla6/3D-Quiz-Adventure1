# QuizVerse 3D

## GitHub Pages

The playable game is maintained as a single HTML file at
`artifacts/3d-game/index.html`. Its HTML, CSS, and game JavaScript are kept
together; Three.js is loaded from jsDelivr. The Pages workflow publishes that
file and its small web manifest/icon metadata to the site root, without running
the Replit/Vite build.

To enable publishing:

1. Open the repository’s **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push changes to `main` (or run the **Deploy QuizVerse 3D to GitHub Pages**
   workflow manually from the Actions tab).
4. Wait for the workflow to finish, then open the Pages URL shown in **Settings
   → Pages**.

The game has no server-side runtime requirement. Progress and settings stay in
the visitor’s browser using local storage. The procedural 3D scene requires a
WebGL-capable browser and the Three.js CDN; the UI falls back to CSS when 3D
initialization is unavailable.