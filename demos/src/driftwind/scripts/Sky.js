// Slow day-night drift: interpolates the palette's sky presets and drives the
// camera sky gradient, fog, the sun and ambient lights. When the renderer has
// a sky dome / post-processing (renderer.sky, renderer.post) it drives those
// too; otherwise the gradient sky and light colours carry the mood.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'Sky',
  description: 'Time-of-day cycle: sky colours, fog, sun and ambient light.',
  props: {
    startTime: { type: 'number', default: 0.71, min: 0, max: 1, label: 'Start (0 midnight, 0.5 noon)' },
    dayLength: { type: 'number', default: 720, min: 10, max: 7200, label: 'Seconds per day' },
    fogNear: { type: 'number', default: 140, min: 0, max: 2000 },
    fogFar: { type: 'number', default: 520, min: 10, max: 5000 },
    paused: { type: 'boolean', default: false },
  },
  onStart(ctx) {
    ctx.state.time = ctx.props.startTime;
    ctx.state.dir = new ctx.math.Vec3();
    this.apply(ctx);
  },
  onUpdate(ctx, dt) {
    if (!ctx.props.paused) ctx.state.time = (ctx.state.time + dt / ctx.props.dayLength) % 1;
    if (ctx.time.frame % 2 === 0) this.apply(ctx);
  },
  apply(ctx) {
    const P = pg(ctx);
    if (!P) return;
    const t = ctx.state.time;
    const sky = P.palettes.skyAt(t);
    const camE = ctx.find('Camera');
    const cam = camE !== undefined ? ctx.getOn(camE, 'Camera3D') : undefined;
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
        // Sun path: rises at t=0.25, peaks at 0.5, sets at 0.75; low sun at golden hour.
        const a = (t - 0.25) * Math.PI * 2;
        const elev = Math.max(0.08, Math.sin(a)) ;
        const dir = ctx.state.dir.set(Math.cos(a) * 0.8, -elev, 0.45).normalize();
        st.setPosition(-dir.x * 200, -dir.y * 200, -dir.z * 200);
        st.updateWorldMatrix();
        st.lookAt(new ctx.math.Vec3(0, 0, 0));
      }
    }
    const ambE = ctx.find('Ambient');
    if (ambE !== undefined) {
      const light = ctx.getOn(ambE, 'Light');
      if (light) { light.color.set(sky.ambient.r, sky.ambient.g, sky.ambient.b, 1); light.intensity = sky.ambientIntensity; }
    }
    // Renderer upgrade hooks (feature-detected; no-ops today).
    const r = ctx.engine.renderer;
    if (r && r.sky && typeof r.sky === 'object') { r.sky.timeOfDay = t; if ('enabled' in r.sky) r.sky.enabled = true; }
    if (r && r.post && typeof r.post === 'object' && !ctx.state.postSet) {
      ctx.state.postSet = true;
      Object.assign(r.post, { enabled: true, bloom: 0.35, bloomThreshold: 0.75, exposure: 1.05, vignette: 0.25, saturation: 1.08 });
    }
  },
});
