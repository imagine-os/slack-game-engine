# Bundled demo projects

Owned by the demos worker. Each demo lives in `public/demos/<id>/project.json`
(a Forge `Project` document) with its assets next to it, and is listed in
`index.json`:

```json
{
  "demos": [
    {
      "id": "platformer",
      "title": "Platformer",
      "description": "Run and jump through a tile-based level.",
      "thumbnail": "thumb.png",
      "renderer": "2d",
      "multiplayer": true,
      "players": "2-4",
      "tags": ["physics", "tilemap"]
    }
  ]
}
```

`thumbnail` is relative to the demo folder. The launcher opens
`play.html?project=<id>` and `editor.html?project=<id>`.
