// Golden hour that never ends: the SkySettings component (procedural sky, sun,
// hemisphere ambient and height fog) is kept drifting slowly around sunset,
// and PostProcessSettings adds the filmic look. Without those components
// (older renderer or headless) the legacy path drives the camera gradient,
// linear fog and the Sun / Ambient lights from the palette's sky presets.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'Sky',
  description: 'Time-of-day drift around golden hour; drives sky, fog, sun and post-processing.',
  props: {
    hour: { type: 'number', default: 17.5, min: 0, max: 24, label: 'Centre hour' },
    driftHours: { type: 'number', default: 0.55, min: 0, max: 12, label: 'Drift amplitude (hours)' },
    driftPeriod: { type: 'number', default: 540, min: 10, max: 7200, label: 'Drift period (seconds)' },
    fogNear: { type: 'number', default: 140, min: 0, max: 2000, label: 'Legacy fog near' },
    fogFar: { type: 'number', default: 520, min: 10, max: 5000, label: 'Legacy fog far' },
    paused: { type: 'boolean', default: false },
  },
  onStart(ctx) {
    const s = ctx.state, P = pg(ctx);
    s.elapsed = 0;
    s.dir = new ctx.math.Vec3();
    s.sky = ctx.get('SkySettings') || null;
    // ?time=HH.H pins the hour (screenshots, share links).
    const pinned = P ? parseFloat(P.env.param('time') || '') : NaN;
    s.pinned = Number.isFinite(pinned) ? ((pinned % 24) + 24) % 24 : null;
    // Quality ladder: keep bloom on and the shadow map size fixed at every level. Disabling bloom
    // after it ran leaves the composite's bloom sampler on the shadow-map unit (black frame +
    // GL_INVALID_OPERATION), and a shadow-map resize logs the same GL warning for a frame.
    const r = ctx.engine.renderer;
    if (r && r.autoQuality && Array.isArray(r.autoQuality.levels)) {
      r.autoQuality.levels = [
        { name: 'ultra', renderScale: 1, shadowMapSize: 2048, msaa: 4, bloom: true, fxaa: true },
        { name: 'high', renderScale: 1, shadowMapSize: 2048, msaa: 2, bloom: true, fxaa: true },
        { name: 'medium', renderScale: 0.85, shadowMapSize: 2048, msaa: 0, bloom: true, fxaa: true },
        { name: 'low', renderScale: 0.7, shadowMapSize: 2048, msaa: 0, bloom: true, fxaa: false },
        { name: 'potato', renderScale: 0.5, shadowMapSize: 2048, msaa: 0, bloom: true, fxaa: false },
      ];
    }
    if (s.sky) {
      s.sky.enabled = true;
      // Fog: thin and warm around the islands, thickening toward the sea far below.
      const W = P && P.world;
      s.sky.fogHeight = W ? W.bounds.minY - 360 : -360;
      const cam = this.camera(ctx);
      if (cam) cam.fogEnabled = false;
    }
    this.apply(ctx);
  },
  camera(ctx) {
    const camE = ctx.find('Camera');
    return camE !== undefined ? ctx.getOn(camE, 'Camera3D') : undefined;
  },
  hourNow(ctx) {
    const s = ctx.state;
    if (s.pinned !== null) return s.pinned;
    return ctx.props.hour + Math.sin((s.elapsed / ctx.props.driftPeriod) * Math.PI * 2) * ctx.props.driftHours;
  },
  onUpdate(ctx, dt) {
    if (!ctx.props.paused) ctx.state.elapsed += dt;
    if (ctx.time.frame % 2 === 0) this.apply(ctx);
  },
  apply(ctx) {
    const s = ctx.state;
    const hour = this.hourNow(ctx);
    if (s.sky) { s.sky.timeOfDay = hour; return; }
    this.legacy(ctx, hour / 24);
  },
  /** Pre-SkySettings renderers: gradient sky, linear fog and palette-driven lights. */
  legacy(ctx, t) {
    const P = pg(ctx);
    if (!P) return;
    const sky = P.palettes.skyAt(t);
    const cam = this.camera(ctx);
    if (cam) {
      cam.skyTop.set(sky.top.r, sky.top.g, sky.top.b, 1);
      cam.skyBottom.set(sky.horizon.r, sky.horizon.g, sky.horizon.b, 1);
      cam.fogColor.set(sky.fog.r, sky.fog.g, sky.fog.b, 1);
      cam.clearColor.set(sky.fog.r, sky.fog.g, sky.fog.b, 1);
      cam.fogEnabled = true; cam.fogNear = ctx.props.fogNear; cam.fogFar = ctx.props.fogFar;
    }
    const sunE = ctx.find('Sun');
    if (sunE !== undefined) {
      const light = ctx.getOn(sunE, 'Light');
      const st = ctx.getOn(sunE, 'Transform');
      if (light) { light.color.set(sky.sun.r, sky.sun.g, sky.sun.b, 1); light.intensity = sky.sunIntensity; }
      if (st) {
        const a = (t - 0.25) * Math.PI * 2;
        const elev = Math.max(0.08, Math.sin(a));
        const dir = ctx.state.dir.set(Math.cos(a) * 0.8, -elev, 0.45).normalize();
        st.setPosition(-dir.x * 200, -dir.y * 200, -dir.z * 200);
        st.updateWorldMatrix(true);
        st.lookAt(new ctx.math.Vec3(0, 0, 0));
      }
    }
    const ambE = ctx.find('Ambient');
    if (ambE !== undefined) {
      const light = ctx.getOn(ambE, 'Light');
      if (light) { light.color.set(sky.ambient.r, sky.ambient.g, sky.ambient.b, 1); light.intensity = sky.ambientIntensity; }
    }
  },
});
