# Rendering (WebGL2)

`WebGLRenderer` draws 3D scenes with instanced meshes and is tuned for a
stylised low-poly look: flat shading, vertex-colour palettes, soft shadows, a
procedural sky driven by time of day, stylised water, wind sway and an HDR
post-processing chain. Everything is optional and off by default so existing
scenes render exactly as before; features are enabled through components.

Try it: `play.html?renderer=3d&showcase=1&time=17.5` (add `&cycle=0.2` to
animate the day, `&still=1` for a fixed camera, `&post=0` / `&shadows=0` to
compare).

## Pipeline overview

Per frame (`WebGLRenderer.render`):

1. **Camera** – highest-priority active `Camera3D`; optional `lookAt`; camera
   shake (`renderer.setCameraShake`) is applied to the view matrix. The
   view-projection matrix also yields the culling frustum.
2. **Settings** – the first enabled `SkySettings` and `PostProcessSettings`
   components are picked up. Sky colours, sun direction, ambient and fog are
   evaluated from `timeOfDay` (`SkyMath.evaluateSky`, exposed as
   `renderer.sky`). `PostProcessSettings` is copied into `renderer.post`.
3. **Lights** – one directional light (from its Transform forward, or from
   the sun when `SkySettings.driveLight`), up to 8 point lights, ambient
   lights. Ambient is a hemisphere (sky colour above, ground colour below).
4. **Shadow fit** – when the directional `Light.castShadows` is set, an
   orthographic light frustum is fitted around the camera frustum up to
   `Light.shadowDistance` (`ShadowMath.fitDirectionalShadow`): bounding-sphere
   fit (stable under rotation) and texel snapping (no shimmer on movement).
5. **Batching** – every visible `MeshRenderer` is culled against the camera
   frustum using the mesh bounding sphere (`MeshData.bounds`), its LOD is
   picked by distance, and its world matrix is appended to the batch for
   (mesh, material). Shadow casters inside the light frustum go to a second
   instance list of the same batch, so the shadow pass reuses instancing.
6. **Shadow pass** – depth-only instanced draw into a `DEPTH_COMPONENT24`
   texture (default 2048², configurable) with polygon offset.
7. **Scene pass** – into the post-processing target (RGBA16F when
   `EXT_color_buffer_float` is available, else RGBA8; MSAA when supported) or
   directly to the canvas when post-processing is off and `renderScale` is 1.
   Sky first (fullscreen triangle), then opaque batches, then transparent
   batches (including water) back to front, then debug lines.
8. **Post-processing** – MSAA resolve → bloom (threshold + soft knee, 5-level
   dual-filter down/upsample) → composite (chromatic aberration, exposure,
   ACES/Reinhard tonemap, lift/gamma/gain, contrast, saturation, vignette) →
   optional FXAA → canvas. With tonemapping on, the scene is rendered in
   linear light (material, vertex and texture colours are sRGB-decoded) and
   encoded back to sRGB in the composite.

`renderer.stats` reports `drawCalls`, `batches`, `instances`, `triangles`,
`culled`, `shadowDrawCalls` and `postDrawCalls`.

## Meshes: vertex colours, bounds, flat shading

`MeshData` accepts `colors?: Float32Array` (RGB per vertex) and
`bounds?: { min, max }` (computed from positions when omitted). Register
meshes with `renderer.addMesh(name, data)` and reference them by name in
`MeshRenderer.mesh`. GLTF `COLOR_0` attributes are imported as vertex colours.

```ts
renderer.addMesh('tree', { positions, colors, indices, bounds });
// MeshRenderer: { mesh: 'tree', flatShading: true, vertexColors: true }
```

- `MeshRenderer.vertexColors` (default `true`) multiplies the material colour
  by the vertex colour when the mesh has colours.
- `MeshRenderer.flatShading` computes per-face normals from screen-space
  derivatives, so shared-vertex meshes still shade as facets.
- `MeshRenderer.emissive` × `emissiveStrength` is added after lighting;
  strengths above 1 glow through bloom.
- `MeshRenderer.unlitFog` (default `true`) lets unlit materials opt out of fog.

## Shadows

```ts
// Light component on the sun entity
{ kind: 'directional', castShadows: true, shadowDistance: 80, shadowBias: 0.05, shadowNormalBias: 1.5, shadowSoftness: 1 }
```

- `castShadows` enables the shadow map for the (first) directional light.
- `shadowDistance` – how far from the camera shadows are drawn; shadows fade
  out over the last 20%. Smaller distances give sharper shadows.
- `shadowBias` is in world units (slope-scaled in the shader); raise it for
  acne, lower it for peter-panning. `shadowNormalBias` offsets receivers along
  their normal in texels. `shadowSoftness` is the 3×3 PCF kernel radius in
  texels (0 = hard). PCF taps use hardware depth comparison, so edges are
  bilinear-smooth.
- Per mesh: `MeshRenderer.castShadow` / `receiveShadow` (both default `true`).
  Transparent (opacity < 0.5), wireframe and water meshes never cast.
- Renderer options: `shadows: false` disables shadow maps globally,
  `shadowMapSize` sets the resolution (default 2048).

## Sky, atmosphere and time of day

Add a `SkySettings` component to any entity:

```ts
{ mode: 'procedural', timeOfDay: 17.5, sunAzimuth: 40, clouds: 0.4, turbidity: 0.3,
  fogEnabled: true, fogDensity: 0.01, fogStart: 20, fogHeightFalloff: 0.1, fogHeight: 0 }
```

- `timeOfDay` (0–24; 6 sunrise, 12 noon, 18 sunset) positions the sun
  (`sunAzimuth`, `sunElevationScale`) and picks the palette (night, twilight,
  golden hour, day). `renderer.sky` exposes the resolved `sunDir`,
  `sunColor`, `lightDir`, `lightIntensity`, `zenith`, `horizon`, `mid`,
  `ambientSky`, `ambientGround`, `fogColor` and `night` (0–1).
- `driveLight` (default `true`) makes the directional light follow the sun:
  colour and direction come from the sky, `Light.intensity` scales it, and at
  night a faint bluish moon light (`moonIntensity`) takes over. Hemisphere
  ambient (`ambientIntensity`) and fog colour follow too. Explicit ambient
  `Light`s are added on top.
- Sky look: `sunSize`, `sunGlow`, `stars`, `clouds`, `cloudSpeed`,
  `cloudHeight`, `turbidity` (haze), `exposure`, `tint`.
- Fog: exponential distance fog (`fogDensity`, `fogStart`) combined with a
  height falloff (`fogHeightFalloff` above `fogHeight`), coloured from the
  horizon and blended toward the sun colour when looking at the sun
  (`fogSunBlend`). Camera3D's linear fog (`fogNear`/`fogFar`) is used when
  `SkySettings.fogEnabled` is off.
- `mode: 'gradient'` keeps the legacy `Camera3D.skyTop/skyBottom` gradient
  while still driving lights and fog from the time of day.

Without a `SkySettings` component the renderer behaves as before: gradient
sky, camera fog, flat ambient from ambient lights.

## Water

Add `WaterMaterial` next to a `MeshRenderer` (usually a subdivided plane):

```ts
MeshRenderer: { mesh: 'lake', castShadow: false },
WaterMaterial: { deepColor, shallowColor, foamColor, waveAmplitude: 0.15, waveLength: 6, waveSpeed: 1,
                 waveSteepness: 0.25, waveDirection: 20, crestFoam: 0.75, fresnel: 0.45, specular: 0.8, opacity: 0.85 }
```

Waves are four world-space sines (with slight choppiness) displaced in the
vertex shader, so instances tile seamlessly. Colour is two-tone by wave
height, with a fresnel rim toward the horizon colour, a sun glint, shadows
and fog. Foam appears on crests (`crestFoam`), where the mesh's vertex colour
red channel is high (bake 1 near shores, 0 in deep water — the showcase does
this from the terrain height field), and optionally where a shaped water
mesh's rest height is within `foamWidth` of `shorelineHeight`.
`flatShading` toggles faceted vs. smooth wave normals.

## Wind

Set `MeshRenderer.windStrength` (world units of sway at unit height; 0.1–0.5
is typical) on foliage. Vertices sway proportionally to their height above
the mesh's bottom, in the direction of `renderer.wind.direction` scaled by
`renderer.wind.strength`, with gusts over time. The shadow pass applies the
same displacement. Instancing is preserved (the sway is per vertex in the
shader).

## Post-processing

Add a `PostProcessSettings` component, or set `renderer.post` directly
(`PostSettings`, with `postSettingsToJSON`/`postSettingsFromJSON` helpers):

```ts
PostProcessSettings: { bloomThreshold: 1, bloomIntensity: 0.5, bloomRadius: 1, exposure: 1, tonemap: 'aces',
  saturation: 1.05, contrast: 1.05, vignette: 0.3, vignetteSmoothness: 0.6, chromaticAberration: 0.15, fxaa: true, msaa: 4, hdr: true }
```

- `hdr` requests a half-float target (falls back to RGBA8); `msaa` samples
  (falls back when unsupported for the format).
- `bloom*` – threshold in scene luminance (linear light), soft knee, intensity
  and blur radius.
- `tonemap`: `'aces'` (filmic), `'reinhard'`, `'none'`. `exposure` scales the
  scene before tonemapping.
- Grading (display space): `lift`, `gamma`, `gain` colours, `contrast`,
  `saturation`; `vignette` + `vignetteSmoothness`; `chromaticAberration`.
- `fxaa` adds an edge-blend pass; useful when `msaa` is 0.

## Camera and quality knobs

- `Camera3D.fov` is a plain number; animate it from scripts.
- `renderer.setCameraShake(amplitude, decay = 5)` – decaying view-space
  jitter with a little roll.
- `renderScale` (renderer option or `renderer.renderScale`, 0.25–1) renders
  the scene at a lower resolution and upscales in the composite.
- Frustum culling per instance (`MeshRenderer.frustumCulled`, default
  `true`) using `MeshData.bounds`; shadow casters are culled against the
  light frustum instead so off-screen objects still cast.
- LOD: `MeshRenderer.lods = [{ mesh: 'tree-lod1', distance: 45 }, { mesh: '', distance: 200 }]`
  (ascending distance; an empty mesh name hides the object).
- `AutoQuality` (`renderer.autoQuality`, enable with the `autoQuality` option
  or `.enabled = true`) steps down a ladder (render scale, shadow map size,
  MSAA, bloom, FXAA) when the smoothed FPS stays below `lowFps` and steps back
  up when it stays above `highFps`. Provide your own `levels` for custom
  ladders; renderer option values act as the maximum quality.

Performance guide: the shadow pass roughly doubles vertex work for casters
(disable `castShadow` on grass/small props), MSAA 4× and bloom are the most
expensive post features on integrated GPUs (use `renderScale` 0.75 or the
quality ladder), and every distinct material is a separate instanced draw
call, so share materials and rely on vertex colours for variation.

## Shader sources

GLSL lives in `src/render/webgl/shaders.ts` (lit, unlit, depth, sky, water,
lines) and `src/render/webgl/shadersPost.ts` (bloom, composite, FXAA). Vertex
attribute locations: 0 position, 1 normal, 2 uv, 3–6 instance matrix,
7 colour. Texture units: 0 material texture, 1 shadow map.
