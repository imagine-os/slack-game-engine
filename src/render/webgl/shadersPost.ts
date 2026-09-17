/** GLSL ES 3.00 sources for the post-processing chain (see `PostProcess.ts`). */

export const POST_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** Threshold with soft knee, sampled with a 4-tap box (source is full res, target half res). */
export const BLOOM_PREFILTER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uThreshold; // threshold, knee
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUV + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uTex, vUV + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uTex, vUV + uTexel * vec2(-0.5, 0.5)).rgb
         + texture(uTex, vUV + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(64.0));
  float br = max(c.r, max(c.g, c.b));
  float knee = max(uThreshold.y, 1e-4);
  float soft = clamp(br - uThreshold.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, br - uThreshold.x) / max(br, 1e-4);
  fragColor = vec4(c * contribution, 1.0);
}
`;

/** Dual-filter (Kawase) downsample. uTexel = half a source pixel. */
export const BLOOM_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec3 sum = texture(uTex, vUV).rgb * 4.0;
  sum += texture(uTex, vUV - uTexel).rgb;
  sum += texture(uTex, vUV + uTexel).rgb;
  sum += texture(uTex, vUV + vec2(uTexel.x, -uTexel.y)).rgb;
  sum += texture(uTex, vUV - vec2(uTexel.x, -uTexel.y)).rgb;
  fragColor = vec4(sum / 8.0, 1.0);
}
`;

/** Dual-filter upsample of `uTex` (lower level) added to `uAdd` (this level's downsample). */
export const BLOOM_UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uAdd;
uniform vec2 uTexel; // one source pixel * radius
out vec4 fragColor;
void main() {
  vec2 o = uTexel;
  vec3 sum = texture(uTex, vUV + vec2(-o.x * 2.0, 0.0)).rgb;
  sum += texture(uTex, vUV + vec2(-o.x, o.y)).rgb * 2.0;
  sum += texture(uTex, vUV + vec2(0.0, o.y * 2.0)).rgb;
  sum += texture(uTex, vUV + vec2(o.x, o.y)).rgb * 2.0;
  sum += texture(uTex, vUV + vec2(o.x * 2.0, 0.0)).rgb;
  sum += texture(uTex, vUV + vec2(o.x, -o.y)).rgb * 2.0;
  sum += texture(uTex, vUV + vec2(0.0, -o.y * 2.0)).rgb;
  sum += texture(uTex, vUV + vec2(-o.x, -o.y)).rgb * 2.0;
  fragColor = vec4(sum / 12.0 + texture(uAdd, vUV).rgb, 1.0);
}
`;

/**
 * Final composite: bloom add, chromatic aberration, exposure, tonemapping,
 * lift/gamma/gain, contrast, saturation and vignette. With `uLinear` the
 * scene is linear and the output is sRGB-encoded.
 */
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform bool uHasBloom;
uniform bool uLinear;
uniform int uTonemap; // 0 none, 1 aces, 2 reinhard
uniform vec4 uParams;  // exposure, bloomIntensity, saturation, contrast
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uVignette; // intensity, smoothness, aspect
uniform float uChroma;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 centered = vUV - 0.5;
  vec3 scene;
  if (uChroma > 0.0) {
    float r2 = dot(centered, centered);
    vec2 off = centered * (uChroma * 0.03 * r2 * 2.0);
    scene.r = texture(uScene, vUV + off).r;
    scene.g = texture(uScene, vUV).g;
    scene.b = texture(uScene, vUV - off).b;
  } else {
    scene = texture(uScene, vUV).rgb;
  }
  if (uHasBloom) scene += texture(uBloom, vUV).rgb * uParams.y;
  vec3 c = max(scene, vec3(0.0)) * uParams.x;
  if (uTonemap == 1) c = aces(c);
  else if (uTonemap == 2) c = c / (1.0 + c);
  else c = clamp(c, 0.0, 1.0);
  if (uLinear) c = pow(c, vec3(1.0 / 2.2));
  // Lift / gamma / gain in display space.
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, vec3(0.0)), 1.0 / max(uGamma, vec3(0.05)));
  c = (c - 0.5) * uParams.w + 0.5;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uParams.z);
  if (uVignette.x > 0.0) {
    vec2 v = centered * vec2(uVignette.z, 1.0);
    float dist = length(v) / length(vec2(uVignette.z, 1.0) * 0.5);
    float vig = 1.0 - uVignette.x * smoothstep(1.0 - uVignette.y, 1.05, dist);
    c *= vig;
  }
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** Compact FXAA (luma-based edge blend) for LDR input. */
export const FXAA_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 fragColor;
const float SPAN_MAX = 8.0;
const float REDUCE_MUL = 1.0 / 8.0;
const float REDUCE_MIN = 1.0 / 128.0;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 rgbNW = texture(uTex, vUV + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(uTex, vUV + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(uTex, vUV + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture(uTex, vUV + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture(uTex, vUV).rgb;
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { fragColor = vec4(rgbM, 1.0); return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * REDUCE_MUL), REDUCE_MIN);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(SPAN_MAX), max(vec2(-SPAN_MAX), dir * rcpDirMin)) * uTexel;
  vec3 rgbA = 0.5 * (texture(uTex, vUV + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uTex, vUV + dir * -0.5).rgb + texture(uTex, vUV + dir * 0.5).rgb);
  float lB = luma(rgbB);
  fragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}
`;
