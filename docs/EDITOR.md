# Forge Editor

The editor (`editor.html`) is a browser-based scene, script and asset editor
for Forge Engine projects. Everything you make is saved in your browser
(IndexedDB) and can be exported as a single JSON file.

## Opening the editor

| URL | What happens |
| --- | --- |
| `editor.html` | Welcome dialog: new 2D/3D project, recent projects, demo templates, import |
| `editor.html?project=<id>` | Open a project saved in this browser (the launcher links here) |
| `editor.html?template=<demoId>` | Open a bundled demo as a template (save it as your own project to keep changes) |
| `editor.html?new=2d` / `?new=3d` | Create a new project immediately |
| `editor.html?project=<id>&room=<roomId>` | Open a project and join/start a collaboration room |

Projects autosave a couple of seconds after every change. Templates are never
autosaved: use **File › Save as my project**. The status bar shows the save state.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ File Edit Entity Scene View Play Collaborate Help   (menu bar)│
│ [Select Move Rotate Scale] [Snap Grid Colliders] [Undo Redo]  │
│ [Play Stop Step ▸tab ▸multi]  Scene ▾        users  Collaborate│
├──────────┬────────────────────────────────────┬──────────────┤
│Hierarchy │            Viewport                │  Inspector   │
│          │  grid · gizmos · selection         │  components  │
├──────────┴────────────────────────────────────┴──────────────┤
│ Assets │ Scripts │ Console │ Project │ History   (bottom dock)│
├──────────────────────────────────────────────────────────────┤
│ project · saved state · scene · selection      play/collab   │
└──────────────────────────────────────────────────────────────┘
```

Panels are separated by draggable splitters (double-click a splitter to
collapse the panel). Layout sizes persist in `localStorage`. **View** toggles
each panel (`Ctrl+1/2/3`) and resets the layout.

## Viewport

- **Select**: click an entity. `Shift` adds, `Ctrl` toggles. Drag on empty
  space for a box selection. Double-click frames the entity.
- **Navigate**: middle-drag or `Alt`+drag pans, wheel zooms around the
  cursor. In 3D, right-drag orbits and middle-drag pans (`OrbitController`).
  `F` frames the selection, `Home` resets the camera.
- **Transform**: `W` move, `E` rotate, `R` scale, `Q` select. Drag the gizmo
  axes/handles or drag the entity body to move it. Arrow keys nudge (`Shift`
  for larger steps). `Escape` cancels a drag.
- **Snapping**: `S` toggles; the toolbar sets the grid step; **Edit › Snap
  settings** sets angle and scale steps. Hold `Ctrl` while dragging to invert
  snapping temporarily.
- **Overlays**: `G` grid + axes, `C` collider shapes, **View › bounds** for
  every entity's bounds, gizmos on/off.
- **Camera bookmarks**: the bookmark button in the viewport corner saves and
  recalls camera poses per scene (stored with the scene).
- **Asset drops**: drag an image from Assets onto the viewport to create a
  Sprite (3D: a textured cube); drag audio onto a hierarchy row to add an
  `AudioSource`.
- Right-click for a context menu: create entities at the cursor, paste,
  frame, bookmarks.

The viewport hosts a real `Engine` with rendering enabled and simulation
paused, so what you see is what the player renders. Hidden entities (eye
toggle) are only hidden in the editor.

## Hierarchy

Tree of entities. Click/`Shift`/`Ctrl` select, arrow keys navigate, `F2` or
double-click renames, drag rows to reparent (drop above/below for ordering,
onto a row to make it a child; world transform is preserved). The eye and lock
toggles are editor-only metadata (stored in `scene.settings.editor`). Locked
entities cannot be moved in the viewport or box-selected. The search box
filters by name or component type. Right-click for create/duplicate/delete,
prefab creation and prefab instantiation.

## Inspector

Component editors are generated from `Registry.fields(type)`: numbers (drag
the small handle to scrub, sliders when min/max are known, arithmetic like
`+=2` works in the field), strings, booleans, vectors, rotation (degrees;
single angle in 2D), colors (picker + hex + alpha), rects, enums, asset
pickers (project assets, thumbnails, drop target), entity references (pick
in the hierarchy/viewport) and raw JSON.

With several entities selected only shared components are shown and edits
apply to all of them (mixed values show as "—"). Each component has a menu
(reset, copy/paste values, remove). **Add component** lists every registered
component grouped by category with search; `requires` dependencies are added
automatically.

**Script** components get a dedicated editor: choose a project script, edit
its declared `props` with the same field editors, open it in the Scripts tab
or create a new script from the entity.

## Scripts

CodeMirror 6 editor with line numbers, folding, bracket matching, search
(`Ctrl+F`), API autocompletion generated from `SCRIPT_API_DTS` (`ctx.`,
`ctx.transform.`, hook names, `ctx.props.` with your own props) and a
searchable API reference sidebar. Syntax errors are underlined live;
`Ctrl+S` compiles through `ScriptRuntime.reload` and shows compile errors in
a banner and in the Console. Templates: Player controller, Spawner, Trigger
zone, Camera follow, Net player, Game manager.

## Assets

Upload (or drop) images, audio, JSON, glTF and text files. They are stored as
data URLs inside the project manifest, so large files are warned about.
Right-click an image for **Slice into atlas**: a grid slicer that creates an
`atlas` asset (frames `prefix0..N`, optional animation) usable by `Sprite`
and `AnimatedSprite`. Prefabs created from the hierarchy are listed here and
can be instantiated or deleted.

## Play mode

**Play** serializes the current scene and runs it in a second engine layered
over the viewport with scripts, physics and input (`runProject`). **Pause**,
**Step** (one fixed step) and **Stop** are in the toolbar; `Space` toggles
play/pause. Stopping discards the play world, so the edit scene is restored
exactly. Runtime diagnostics stream into the Console tab (with a badge).
**Play in new tab** opens `play.html?project=<id>`; **Play multiplayer**
adds a fresh `room` id like the launcher does.

## Undo / redo

Every mutation (transform drags, field edits, add/remove component,
create/delete/reparent/rename entities, script saves, asset and settings
changes, scene management) is a command on one stack. Consecutive edits of
the same field or script coalesce into a single step. The **History** tab
lists all steps; click one to jump there.

## Collaboration

1. Click **Collaborate** (or **Collaborate › Start collaboration session**).
   A room id is generated and the invite link is copied.
2. Send the link (`editor.html?project=<id>&room=<roomId>`). People opening it
   join the room; if they do not have the project the host sends the full
   state on join.
3. Everyone sees colored user chips in the toolbar, live selection highlights
   in the hierarchy and viewport, and cursors in the viewport. Click a chip to
   **follow** that user's camera and scene.

How it works: edits are broadcast as operations (entity create/delete/
reparent, component add/remove, field set, script/asset/settings changes)
stamped with a Lamport clock. Field writes are last-writer-wins per field;
script files are whole-file last-writer-wins, and if two people saved the
same script within two seconds the later receiver gets a conflict banner
(**Keep mine** / **Take theirs**) instead of a silent overwrite. Remote edits
go through the same mutation layer but never enter your undo stack.

Transport: when the networking layer provides `engine.net.connect` /
`engine.net.channel`, rooms work across devices. Without it, the editor falls
back to a same-browser `BroadcastChannel` implementation, so you can test
collaboration with two tabs of the same browser. Set `?net=local` to force the
fallback.

## Keyboard shortcuts

Press `?` in the editor for the complete, always up-to-date list. Highlights:

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save project (compiles the open script first) |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+D` | Duplicate |
| `Delete` | Delete selected |
| `Ctrl+C` / `Ctrl+V` | Copy / paste entities |
| `Ctrl+A` | Select all |
| `Q` `W` `E` `R` | Select / Move / Rotate / Scale tool |
| `F` | Frame selected |
| `G` / `C` / `S` | Grid / Colliders / Snapping |
| `Space` | Play / Pause |
| `Ctrl+P` / `Ctrl+Shift+P` / `Ctrl+.` | Play / Stop / Step |
| `Ctrl+K` | Command palette (every action) |
| `Ctrl+1` `Ctrl+2` `Ctrl+3` | Toggle hierarchy / inspector / bottom dock |
| `Ctrl+Shift+E` | Export project JSON |
| `F2` | Rename |
| `Shift+P` | Move selection to root |
| `?` | Shortcut cheat sheet |

## Where things are stored

- Projects: IndexedDB database `forge-engine`, store `projects` (same as the
  launcher and player).
- Editor-only metadata: `scene.settings.editor` (`entities` with stable guids
  and hidden/locked flags, `camera`, `bookmarks`). Players ignore it.
- UI preferences (layout, snapping, tour done, display name): `localStorage`
  keys prefixed `forge.editor.`.

## Source layout

```
src/editor/
  main.ts            entry: URL parsing, welcome dialog, boot
  app/               EditorApp (shell, menus, toolbar, actions), state, layout, shortcuts
  commands/          CommandStack + scene/project commands
  project/           SceneEditor (mutation API over the World), ProjectService, entity presets
  viewport/          Viewport, EditorCamera, Picking, Gizmo, PlayMode
  inspector/         Inspector + generic field editors
  panels/            Hierarchy, Assets, Scripts, Console, Settings, History
  scripts/           CodeMirror wrapper, API docs parser, templates
  assets/            Atlas slicer
  collab/            Channel adapters, OpModel (Lamport/LWW), CollabSession
  onboarding/        Guided tour
  ui/                DOM helpers, menus, dialogs, tabs, palette, tooltips, toasts, help
```
