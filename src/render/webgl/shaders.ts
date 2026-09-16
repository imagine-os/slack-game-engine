/** GLSL ES 3.00 sources for the WebGL renderer. */

export const MAX_POINT_LIGHTS = 8;

const INSTANCE_ATTRIBS = /* glsl */ `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aModel0;
layout(location = 4) in vec4 aModel1;
layout(location = 5) in vec4 aModel2;
layout(location = 6) in vec4 aModel3;
`;

export const LIT_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
void main() {
  mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
  vec4 wp = model * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(transpose(inverse(mat3(model))) * aNormal);
  vUV = aUV;
  gl_Position = uViewProj * wp;
}
`;

export const LIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
uniform vec4 uColor;
uniform vec3 uEmissive;
uniform float uMetallic;
uniform float uRoughness;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform vec3 uCameraPos;
uniform vec3 uAmbient;
uniform vec3 uDirLightDir;
uniform vec3 uDirLightColor;
uniform int uPointCount;
uniform vec3 uPointPos[${MAX_POINT_LIGHTS}];
uniform vec3 uPointColor[${MAX_POINT_LIGHTS}];
uniform float uPointRange[${MAX_POINT_LIGHTS}];
uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
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
  if (uHasTexture) base *= texture(uTexture, vUV);
  vec3 albedo = base.rgb;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 color = albedo * uAmbient;
  color += shade(N, V, normalize(-uDirLightDir), uDirLightColor, albedo, uMetallic, uRoughness);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= uPointCount) break;
    vec3 d = uPointPos[i] - vWorldPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / uPointRange[i], 0.0, 1.0);
    att *= att;
    color += shade(N, V, d / max(dist, 0.0001), uPointColor[i] * att, albedo, uMetallic, uRoughness);
  }
  color += uEmissive;
  if (uFogEnabled) {
    float dist = length(uCameraPos - vWorldPos);
    float f = clamp((dist - uFogRange.x) / max(uFogRange.y - uFogRange.x, 0.001), 0.0, 1.0);
    color = mix(color, uFogColor, f);
  }
  fragColor = vec4(color, base.a * uOpacity);
}
`;

export const UNLIT_VS = /* glsl */ `#version 300 es
precision highp float;
${INSTANCE_ATTRIBS}
uniform mat4 uViewProj;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
  vec4 wp = model * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vUV = aUV;
  gl_Position = uViewProj * wp;
}
`;

export const UNLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorldPos;
uniform vec4 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform vec3 uCameraPos;
uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
out vec4 fragColor;
void main() {
  vec4 base = uColor;
  if (uHasTexture) base *= texture(uTexture, vUV);
  vec3 color = base.rgb + uEmissive;
  if (uFogEnabled) {
    float dist = length(uCameraPos - vWorldPos);
    float f = clamp((dist - uFogRange.x) / max(uFogRange.y - uFogRange.x, 0.001), 0.0, 1.0);
    color = mix(color, uFogColor, f);
  }
  fragColor = vec4(color, base.a * uOpacity);
}
`;

export const SKY_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out float vY;
void main() {
  vY = aPosition.y;
  gl_Position = vec4(aPosition, 0.9999, 1.0);
}
`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in float vY;
uniform vec3 uTop;
uniform vec3 uBottom;
out vec4 fragColor;
void main() {
  float t = smoothstep(-0.2, 0.6, vY);
  fragColor = vec4(mix(uBottom, uTop, t), 1.0);
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
