# Bundled demo projects

Generated from `demos/src/**` by `npm run build:demos`; do not edit by hand
(tests fail when the output is stale). Each demo lives in `<id>/project.json`
(a Forge `Project` document) with its assets, a `thumbnail.svg` and a
`README.md` next to it, and is listed in `index.json`:

```json
{
  "demos": [
    {
      "id": "arena-blasters",
      "name": "Arena Blasters",
      "title": "Arena Blasters",
      "description": "Top-down arena shooter for 1-8 players ...",
      "thumbnail": "thumbnail.svg",
      "renderer": "2d",
      "multiplayer": true,
      "players": { "min": 1, "max": 8 },
      "tags": ["shooter", "physics"],
      "controls": ["A/D: turn", "W: thrust", "J / click: fire"],
      "featured": true,
      "template": false
    }
  ]
}
```

`thumbnail` is relative to the demo folder. `title` duplicates `name` for
older launcher builds; `players` may also be a string such as `"2-4"`.
`template: true` marks the starter projects that "New project" copies. The
launcher opens `play.html?project=<id>` and `editor.html?project=<id>`.
