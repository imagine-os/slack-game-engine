# demos/

Sources of the bundled demo projects. The published, playable output lives in
`public/demos/` and is generated from here with `npm run build:demos`.

```
src/lib.ts             SceneBuilder, prefab(), loadScripts(), makeProject()
src/index.ts           registry (order = launcher order)
src/<id>/index.ts      scene + prefabs + assets + README for one demo
src/<id>/scripts/*.js  the demo's scripts (one defineScript per file)
```

See `docs/DEMOS.md` for the gallery, the multiplayer pattern shared by every
demo and a walkthrough for building your own game from a template.

Workflow: edit sources → `npm run build:demos` → `npm run dev` and open
`play.html?project=<id>` → `npm test` (checks that the committed JSON is up to
date and that every demo runs headlessly) → optionally
`npm run verify:demos` for a Playwright smoke test with screenshots.
