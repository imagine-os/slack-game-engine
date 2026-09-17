/**
 * GLSL ES 3.00 sources for the WebGL renderer's scene passes: lit/unlit mesh
 * shaders (vertex colours, flat shading, wind, hemisphere ambient, shadows,
 * fog), the shadow depth pass, the procedural sky, stylised water and debug
 * lines. Post-processing shaders live in `shadersPost.ts`.
 */

export const MAX_POINT_LIGHTS = 8;

/** Attribute layout shared by every mesh shader (see `ATTRIB_*` in Mesh.ts). */
const INSTANCE_ATTRIBS = /* glsl */ `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aModel0;
layout(location = 4) in vec4 aModel1;
layout(location = 5) in vec4 aModel2;
layout(location = 6) in vec4 aModel3;
layout(location = 7) in vec3 aColor;
`;

/** Vertex wind sway. `uWind.xyz` = world direction * global strength, `uWind.w` = time. */
const WIND_GLSL = /* glsl */ `
uniform vec4 uWind;
uniform float uWindStrength;
uniform float uMeshMinY;
vec3 windOffset(vec3 wp, float height) {
  if (uWindStrength <= 0.0) return vec3(0.0);
  float h = max(height, 0.0);
  float phase = dot(wp.xz, vec2(0.37, 0.29)) + uWind.w * 1.7;
  float sway = sin(phase) * 0.6 + sin(phase * 2.3 + 1.3) * 0.25 + sin(phase * 4.1 + wp.y) * 0.15;
  float gust = 0.7 + 0.3 * sin(uWind.w * 0.6 + wp.x * 0.05);
  vec3 dir = uWind.xyz;
  // Slight perpendicular wobble so canopies do not all lean the same way.
  dir += vec3(-dir.z, 0.0, dir.x) * 0.35 * sin(phase * 1.7 + 0.5);
  return dir * (uWindStrength * sway * gust * h * (0.35 + 0.65 * min(h, 1.0)));
}
`;

/** sRGB decode for vertex colours/textures when the pipeline is linear (post-processing on). */
const LINEAR_GLSL = /* glsl */ `
uniform bool uLinear;
vec3 toLinear(vec3 c) { return uLinear ? pow(max(c, vec3(0.0)), vec3(2.2)) : c; }
`;

/**
 * Fog. Mode 0 = none, 1 = linear (Camera3D.fogNear/fogFar in uFogParams.xy),
 * 2 = atmospheric: uFogParams = (density, start, heightFalloff, baseHeight),
 * with an extra tint toward the sun (uFogSun.rgb, strength uFogSun.a).
 */
const FOG_GLSL = /* glsl */ `
uniform int uFogMode;
uniform vec3 uFogColor;
uniform vec4 uFogParams;
uniform vec4 uFogSun;
uniform vec3 uSunDir;
float fogAmount(vec3 wp) {
  vec3 ray = wp - uCameraPos;
  float dist = length(ray);
  if (uFogMode == 1) return clamp((dist - uFogParams.x) / max(uFogParams.y - uFogParams.x, 0.001), 0.0, 1.0);
  if (uFogMode == 2) {
    float d = max(dist - uFogParams.y, 0.0);
    float falloff = uFogParams.z;
    float camH = uCameraPos.y - uFogParams.w;
    float dy = ray.y;
    // Analytic integral of exp(-falloff * height) along the ray.
    float densityAtCam = exp(-falloff * camH);
    float integral = abs(falloff * dy) > 1e-3 ? densityAtCam * (1.0 - exp(-falloff * dy)) / (falloff * dy) : densityAtCam;
    return 1.0 - exp(-uFogParams.x * d * max(integral, 0.0));
  }
  return 0.0;
}
vec3 applyFog(vec3 color, vec3 wp) {
  if (uFogMode == 0) return color;
  float f = fogAmount(wp);
  vec3 fogCol = uFogColor;
  if (uFogMode == 2 && uFogSun.a > 0.0) {
    vec3 v = normalize(wp - uCameraPos);
    float sunAmount = pow(max(dot(v, uSunDir), 0.0), 6.0);
    fogCol = mix(fogCol, uFogSun.rgb, sunAmount * uFogSun.a);
  }
  return mix(color, fogCol, f);
}
`;

/**
 * Directional shadow lookup with normal offset, slope-scaled bias and 3x3 PCF
 * over a hardware-compared depth texture. uShadowParams = (texel uv size,
 * depth bias in depth units, normal offset in world units, softness in texels).
 */
const SHADOW_GLSL = /* glsl */ `
uniform bool uShadows;
precision highp sampler2DShadow;
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec4 uShadowParams;
uniform vec2 uShadowFade;
float shadowAt(vec3 wp, vec3 N, float NdotL) {
  vec3 p = wp + N * (uShadowParams.z * (1.2 - NdotL * 0.7));
  vec4 sp = uShadowMatrix * vec4(p, 1.0);
  vec3 uvz = sp.xyz / sp.w * 0.5 + 0.5;
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 1.0;
  float sinT = sqrt(max(1.0 - NdotL * NdotL, 0.0));
  float slope = clamp(sinT / max(NdotL, 0.15), 0.0, 5.0);
  float ref = uvz.z - uShadowParams.y * (1.0 + slope);
  float r = uShadowParams.w * uShadowParams.x;
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(uShadowMap, vec3(uvz.xy + vec2(float(x), float(y)) * r, ref));
    }
  }
  s /= 9.0;
  float d = length(uCameraPos - wp);
  float fade = clamp((uShadowFade.y - d) / max(uShadowFade.y - uShadowFade.x, 0.001), 0.0, 1.0);
  return mix(1.0, s, fade);
}
`;

const MODEL_GLSL = /* glsl */ `
mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
vec4 wp = model * vec4(aPosition, 1.0);
wp.xyz += windOffset(wp.xyz, (aPosition.y - uMeshMinY) * length(model[1].xyz));
`;

export const LIT_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
uniform bool uVertexColors;
${WIND_GLSL}
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
void main() {
  ${MODEL_GLSL}
  vWorldPos = wp.xyz;
  vNormal = normalize(transpose(inverse(mat3(model))) * aNormal);
  vUV = aUV;
  vColor = uVertexColors ? aColor : vec3(1.0);
  gl_Position = uViewProj * wp;
}
`;

export const LIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
uniform vec4 uColor;
uniform vec3 uEmissive;
uniform float uEmissiveStrength;
uniform float uMetallic;
uniform float uRoughness;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform bool uFlatShading;
uniform bool uReceiveShadow;
uniform vec3 uCameraPos;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uDirLightDir;
uniform vec3 uDirLightColor;
uniform int uPointCount;
uniform vec3 uPointPos[${MAX_POINT_LIGHTS}];
uniform vec3 uPointColor[${MAX_POINT_LIGHTS}];
uniform float uPointRange[${MAX_POINT_LIGHTS}];
${LINEAR_GLSL}
${FOG_GLSL}
${SHADOW_GLSL}
out vec4 fragColor;

vec3 shade(vec3 N, vec3 V, vec3 L, vec3 lightColor, vec3 albedo, float metallic, float roughness) {
  float NdotL = max(dot(N, L), 0.0);
  if (NdotL <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float shininess = mix(256.0, 4.0, roughness);
  float spec = pow(NdotH, shininess) * (1.0 - roughness * 0.7);
  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  vec3 diffuse = albedo * (1.0 - metallic);
  return (diffuse + F0 * spec) * lightColor * NdotL;
}

void main() {
  vec4 base = uColor;
  base.rgb *= toLinear(vColor);
  if (uHasTexture) {
    vec4 t = texture(uTexture, vUV);
    t.rgb = toLinear(t.rgb);
    base *= t;
  }
  vec3 albedo = base.rgb;
  vec3 N;
  if (uFlatShading) {
    N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  } else {
    N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
  }
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 ambient = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5);
  vec3 color = albedo * ambient;
  vec3 L = normalize(-uDirLightDir);
  float NdotL = max(dot(N, L), 0.0);
  float sh = (uShadows && uReceiveShadow && NdotL > 0.0) ? shadowAt(vWorldPos, N, NdotL) : 1.0;
  color += shade(N, V, L, uDirLightColor * sh, albedo, uMetallic, uRoughness);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= uPointCount) break;
    vec3 d = uPointPos[i] - vWorldPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / uPointRange[i], 0.0, 1.0);
    att *= att;
    color += shade(N, V, d / max(dist, 0.0001), uPointColor[i] * att, albedo, uMetallic, uRoughness);
  }
  color += uEmissive * uEmissiveStrength;
  color = applyFog(color, vWorldPos);
  fragColor = vec4(color, base.a * uOpacity);
}
`;

export const UNLIT_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
uniform bool uVertexColors;
${WIND_GLSL}
out vec2 vUV;
out vec3 vWorldPos;
out vec3 vColor;
void main() {
  ${MODEL_GLSL}
  vWorldPos = wp.xyz;
  vUV = aUV;
  vColor = uVertexColors ? aColor : vec3(1.0);
  gl_Position = uViewProj * wp;
}
`;

export const UNLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorldPos;
in vec3 vColor;
uniform vec4 uColor;
uniform vec3 uEmissive;
uniform float uEmissiveStrength;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform bool uUnlitFog;
uniform vec3 uCameraPos;
${LINEAR_GLSL}
${FOG_GLSL}
out vec4 fragColor;
void main() {
  vec4 base = uColor;
  base.rgb *= toLinear(vColor);
  if (uHasTexture) {
    vec4 t = texture(uTexture, vUV);
    t.rgb = toLinear(t.rgb);
    base *= t;
  }
  vec3 color = base.rgb + uEmissive * uEmissiveStrength;
  if (uUnlitFog) color = applyFog(color, vWorldPos);
  fragColor = vec4(color, base.a * uOpacity);
}
`;

/** Shadow-map depth pass (no colour output). */
export const DEPTH_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
${WIND_GLSL}
void main() {
  ${MODEL_GLSL}
  gl_Position = uViewProj * wp;
}
`;

export const DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
void main() {}
`;

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vNdc;
void main() {
  vNdc = aPosition;
  gl_Position = vec4(aPosition, 0.9999, 1.0);
}
`;

/**
 * Sky. Mode 0 reproduces the legacy two-colour screen gradient; mode 1 is the
 * procedural dome: horizon/zenith gradient with haze, sun disc and glow,
 * stars at night and an optional cloud band.
 */
export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vNdc;
uniform int uMode;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform mat4 uInvViewProj;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec4 uSunParams;   // cos(disc half-angle), glow, turbidity, night
uniform vec4 uCloudParams; // coverage, scrolled time, height, stars
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return v;
}

void main() {
  if (uMode == 0) {
    float t = smoothstep(-0.2, 0.6, vNdc.y);
    fragColor = vec4(mix(uBottom, uTop, t), 1.0);
    return;
  }
  vec4 pn = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 pf = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(pf.xyz / pf.w - pn.xyz / pn.w);
  float h = d.y;
  float turb = uSunParams.z;
  float night = uSunParams.w;
  // Three-stop gradient; haze keeps the horizon band taller.
  float t1 = smoothstep(0.0, 0.06 + turb * 0.12, h);
  float t2 = smoothstep(0.03, 0.38 + turb * 0.2, h);
  vec3 sky = mix(mix(uHorizon, uMid, t1), uZenith, t2);
  vec3 col = h < 0.0 ? mix(uHorizon, uGround, smoothstep(0.0, 0.3, -h)) : sky;
  // Sun.
  float cosA = dot(d, uSunDir);
  float aboveGround = smoothstep(-0.03, 0.0, h);
  float lowSun = 1.0 - clamp(uSunDir.y * 3.0, 0.0, 1.0);
  float glow = pow(max(cosA, 0.0), 6.0) * 0.18 + pow(max(cosA, 0.0), 48.0) * 0.55;
  col += uSunColor * glow * uSunParams.y * (0.5 + lowSun) * aboveGround;
  // Warm band along the horizon on the sun side at low sun.
  float horizonBand = exp(-abs(h) * 14.0) * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4)), 0.0), 3.0);
  col += uSunColor * horizonBand * lowSun * 0.35 * (1.0 - night);
  float disc = smoothstep(uSunParams.x - 0.0008, uSunParams.x + 0.0004, cosA);
  col += uSunColor * disc * 6.0 * aboveGround * step(0.0, uSunDir.y + 0.02);
  // Stars.
  if (night > 0.0 && uCloudParams.w > 0.0 && h > 0.0) {
    vec3 p = d * 140.0;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    float rnd = hash31(cell);
    vec3 off = vec3(hash31(cell + 1.7), hash31(cell + 3.1), hash31(cell + 5.3)) - 0.5;
    float star = smoothstep(0.16, 0.0, length(f - off * 0.6)) * step(0.955, rnd);
    float twinkle = 0.7 + 0.3 * sin(uCloudParams.y * 3.0 + rnd * 40.0);
    col += vec3(0.9, 0.95, 1.0) * star * twinkle * night * uCloudParams.w * smoothstep(0.0, 0.2, h) * (1.2 + 1.5 * rnd);
  }
  // Cloud band projected on a dome.
  float coverage = uCloudParams.x;
  if (coverage > 0.0 && h > 0.005) {
    vec2 uv = d.xz / (h + uCloudParams.z) * 0.8 + vec2(uCloudParams.y * 0.02, uCloudParams.y * 0.007);
    float n = fbm(uv * 1.5);
    float a = smoothstep(1.0 - coverage, 1.0 - coverage + 0.35, n) * smoothstep(0.0, 0.15, h);
    vec3 lit = mix(uHorizon, uSunColor, 0.3 * (0.3 + 0.7 * pow(max(cosA, 0.0), 2.0)) * (1.0 - night * 0.9));
    vec3 shadeCol = mix(uZenith, uHorizon, 0.5) * 0.85;
    vec3 cloud = mix(shadeCol, lit * 1.1, smoothstep(0.35, 0.9, n));
    cloud *= 1.0 - night * 0.8;
    col = mix(col, cloud, a * 0.9);
  }
  fragColor = vec4(col, 1.0);
}
`;

/**
 * Stylised water: world-space sum-of-sines waves (four octaves with slight
 * choppiness), flat or analytic normals, two-tone colour by wave height,
 * fresnel rim to the horizon colour, sun glint and animated foam.
 */
export const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
uniform float uTime;
uniform vec4 uWave;      // amplitude, wavelength, speed, steepness
uniform vec2 uWaveDir;
uniform bool uVertexColors;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
out float vHeight;
out float vBaseY;

const float TAU = 6.28318530718;
void wave(vec2 dir, float amp, float len, float speed, inout vec3 p, inout vec3 dPdx, inout vec3 dPdz) {
  float k = TAU / len;
  float c = speed * sqrt(9.8 / k);
  float phase = dot(dir, p.xz) * k + uTime * c * k;
  float s = sin(phase), co = cos(phase);
  float q = uWave.w;
  p.y += amp * s;
  p.xz += -dir * (q * amp * co);
  // Partial derivatives of the displaced position.
  dPdx.y += amp * co * k * dir.x;
  dPdz.y += amp * co * k * dir.y;
  dPdx.xz += dir * (q * amp * s * k * dir.x);
  dPdz.xz += dir * (q * amp * s * k * dir.y);
}
mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

void main() {
  mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
  vec4 wp = model * vec4(aPosition, 1.0);
  vBaseY = wp.y;
  vec3 p = wp.xyz;
  vec3 dPdx = vec3(1.0, 0.0, 0.0), dPdz = vec3(0.0, 0.0, 1.0);
  vec2 d0 = normalize(uWaveDir);
  float A = uWave.x, L = max(uWave.y, 0.05), S = uWave.z;
  wave(d0, A, L, S, p, dPdx, dPdz);
  wave(rot(0.9) * d0, A * 0.55, L * 0.62, S * 1.1, p, dPdx, dPdz);
  wave(rot(-1.4) * d0, A * 0.3, L * 0.37, S * 1.25, p, dPdx, dPdz);
  wave(rot(2.3) * d0, A * 0.18, L * 0.21, S * 1.4, p, dPdx, dPdz);
  vWorldPos = p;
  vNormal = normalize(cross(dPdz, dPdx));
  vHeight = A > 0.0 ? clamp((p.y - wp.y) / (A * 2.03), -1.0, 1.0) : 0.0;
  vUV = aUV;
  vColor = uVertexColors ? aColor : vec3(0.0);
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
in float vHeight;
in float vBaseY;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform vec4 uFoam;        // shorelineHeight, foamWidth, crestFoam, time
uniform vec4 uWaterParams; // fresnel, specular, opacity, flatShading
uniform vec3 uCameraPos;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uDirLightDir;
uniform vec3 uDirLightColor;
uniform bool uReceiveShadow;
uniform vec2 uWaveDir;
${LINEAR_GLSL}
${FOG_GLSL}
${SHADOW_GLSL}
out vec4 fragColor;

void main() {
  float time = uFoam.w;
  vec3 N = uWaterParams.w > 0.5 ? normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))) : normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  float h01 = vHeight * 0.5 + 0.5;
  vec3 albedo = mix(uDeepColor, uShallowColor, smoothstep(0.15, 0.95, h01));
  vec3 ambient = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5);
  vec3 L = normalize(-uDirLightDir);
  float NdotL = max(dot(N, L), 0.0);
  float sh = (uShadows && uReceiveShadow && NdotL > 0.0) ? shadowAt(vWorldPos, N, NdotL) : 1.0;
  vec3 color = albedo * (ambient + uDirLightColor * (0.25 + 0.75 * NdotL) * sh);
  // Sun glint: a tight and a broad lobe.
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float spec = pow(NdotH, 260.0) * 1.4 + pow(NdotH, 32.0) * 0.06;
  color += uDirLightColor * spec * uWaterParams.y * sh;
  // Fresnel rim toward the horizon colour.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  color = mix(color, uFogColor, fres * uWaterParams.x);
  // Foam: crests, baked shore mask (vertex colour red) and a height band.
  vec2 wd = normalize(uWaveDir);
  float ripple = sin(dot(vWorldPos.xz, wd) * 2.1 - time * 2.4) * 0.5 + 0.5;
  float ripple2 = sin(vWorldPos.x * 1.3 + vWorldPos.z * 1.7 + time * 1.1) * 0.5 + 0.5;
  float crest = smoothstep(uFoam.z, min(uFoam.z + 0.18, 1.0), h01) * (0.55 + 0.45 * ripple2);
  float shore = clamp(vColor.r, 0.0, 1.0);
  float shoreFoam = smoothstep(0.62, 1.0, shore + 0.3 * shore * sin(shore * 9.0 - time * 2.2)) * (0.6 + 0.4 * ripple);
  float band = uFoam.y > 0.0 ? 1.0 - smoothstep(0.0, uFoam.y, abs(vBaseY - uFoam.x)) : 0.0;
  float bandFoam = band * smoothstep(0.35, 0.8, ripple * 0.7 + ripple2 * 0.3 + band * 0.3);
  float foam = clamp(crest + shoreFoam + bandFoam, 0.0, 1.0);
  color = mix(color, uFoamColor * (ambient + uDirLightColor * sh), foam * 0.9);
  color = applyFog(color, vWorldPos);
  float alpha = clamp(uWaterParams.z + fres * (1.0 - uWaterParams.z) * 0.5 + foam * 0.4, 0.0, 1.0);
  fragColor = vec4(color, alpha);
}
`;

export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vColor; }
`;
