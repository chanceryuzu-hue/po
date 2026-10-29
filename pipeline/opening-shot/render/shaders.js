// GLSL for the Sentinel shot. Lighting is evaluated analytically:
//  - three rectangular area lights (key softbox, two crimson rims) via the
//    representative-point method, each multiplied by a baked visibility term;
//  - the glowing armour seams as polyline line lights (exact Lambert
//    integral for diffuse, representative point for specular);
//  - a dim analytic environment for ambient reflections, scaled by baked AO.

export const MAX_SEG = 72;
export const MAX_SEAM = 8;

const common = /* glsl */ `
#define PI 3.14159265359
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

export const armorVert = /* glsl */ `
attribute vec3 aTangent;
attribute vec4 aBake;
attribute float aCurv;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vT;
varying vec4 vBake;
varying float vCurv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vT = mat3(modelMatrix) * aTangent;
  vBake = aBake;
  vCurv = aCurv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const armorFrag = /* glsl */ `
precision highp float;
${common}
uniform vec3 uF0;        // specular colour at normal incidence
uniform vec3 uDiffuse;   // diffuse albedo (0 for metals)
uniform float uRough;
uniform float uAniso;
uniform float uStreak;
uniform float uEdge;

uniform vec3 uKeyC; uniform vec3 uKeyU; uniform vec3 uKeyW; uniform vec3 uKeyRad;
uniform vec3 uRimRC; uniform vec3 uRimRU; uniform vec3 uRimRW; uniform vec3 uRimRRad;
uniform vec3 uRimLC; uniform vec3 uRimLU; uniform vec3 uRimLW; uniform vec3 uRimLRad;
uniform vec3 uFillC; uniform vec3 uFillU; uniform vec3 uFillW; uniform vec3 uFillRad;
uniform vec3 uTopC; uniform vec3 uTopU; uniform vec3 uTopW; uniform vec3 uTopRad;
uniform float uRimFloor;
uniform vec4 uSegA[${MAX_SEG}];
uniform vec4 uSegB[${MAX_SEG}];
uniform int uSegCount;
uniform vec4 uSeam[${MAX_SEAM}];
uniform vec3 uSeamColor;
uniform float uSeamSpec;
uniform float uAmb;
uniform vec3 uAmbTint;

varying vec3 vPos;
varying vec3 vN;
varying vec3 vT;
varying vec4 vBake;
varying float vCurv;

struct Surf { vec3 P; vec3 N; vec3 V; vec3 T; vec3 B; vec3 f0; vec3 diff; float at; float ab; float a; };

float D_aniso(float NoH, float ToH, float BoH, float at, float ab){
  float a2 = at * ab;
  vec3 v = vec3(ab * ToH, at * BoH, a2 * NoH);
  float v2 = dot(v, v);
  float w2 = a2 / v2;
  return a2 * w2 * w2 / PI;
}
float V_aniso(float at, float ab, float ToV, float BoV, float ToL, float BoL, float NoV, float NoL){
  float lV = NoL * length(vec3(at * ToV, ab * BoV, NoV));
  float lL = NoV * length(vec3(at * ToL, ab * BoL, NoL));
  return 0.5 / (lV + lL + 1e-5);
}
vec3 F_Schlick(vec3 f0, float VoH){ float f = pow(1.0 - VoH, 5.0); return f0 + (1.0 - f0) * f; }

vec3 specBRDF(Surf s, vec3 L, float NoL){
  vec3 H = normalize(L + s.V);
  float NoV = max(dot(s.N, s.V), 1e-4);
  float NoH = max(dot(s.N, H), 0.0);
  float VoH = max(dot(s.V, H), 0.0);
  float D = D_aniso(NoH, dot(s.T, H), dot(s.B, H), s.at, s.ab);
  float Vis = V_aniso(s.at, s.ab, dot(s.T, s.V), dot(s.B, s.V), dot(s.T, L), dot(s.B, L), NoV, NoL);
  return D * Vis * F_Schlick(s.f0, VoH);
}

// Rectangular area light, representative point for specular.
vec3 rectLight(Surf s, vec3 C, vec3 U, vec3 W, vec3 rad, float vis){
  if (vis <= 0.002 || dot(rad, rad) <= 0.0) return vec3(0.0);
  float hu = length(U), hw = length(W);
  vec3 u = U / hu, w = W / hw;
  vec3 n = normalize(cross(u, w));
  if (dot(n, s.P - C) < 0.0) n = -n;       // emitting side faces the subject
  float area = 4.0 * hu * hw;
  // diffuse from the centre
  vec3 Lc = C - s.P; float dc = length(Lc); Lc /= dc;
  float NoLc = max(dot(s.N, Lc), 0.0);
  float cosL = max(dot(-Lc, n), 0.0);
  vec3 col = s.diff / PI * rad * area * cosL * NoLc / (dc * dc);
  // specular: closest point on the rectangle to the reflection ray
  vec3 R = reflect(-s.V, s.N);
  float den = dot(R, n);
  vec3 hit = C;
  if (den < -1e-4) hit = s.P + R * (dot(C - s.P, n) / den);
  vec3 d = hit - C;
  vec3 Ps = C + u * clamp(dot(d, u), -hu, hu) + w * clamp(dot(d, w), -hw, hw);
  vec3 Ls = Ps - s.P; float ds = length(Ls); Ls /= ds;
  float NoL = max(dot(s.N, Ls), 0.0);
  float cosLs = max(dot(-Ls, n), 0.0);
  float rEff = sqrt(area / PI);
  float aP = clamp(s.a + 0.5 * rEff / ds, 0.0, 1.0);
  float norm = (s.a / aP) * (s.a / aP);
  col += specBRDF(s, Ls, NoL) * NoL * rad * area * cosLs / (ds * ds) * norm;
  return col * vis;
}

vec3 seamLights(Surf s){
  vec3 acc = vec3(0.0);
  vec3 R = reflect(-s.V, s.N);
  for (int i = 0; i < ${MAX_SEG}; i++){
    if (i >= uSegCount) break;
    vec4 A = uSegA[i];
    vec4 Bq = uSegB[i];
    float seamId = floor(Bq.w * 0.5);
    float sb = Bq.w - 2.0 * seamId;
    float sa = A.w;
    vec4 st = uSeam[int(seamId + 0.5)];
    if (st.z <= 0.0) continue;
    float lo = max(min(sa, sb), st.x);
    float hi = min(max(sa, sb), st.y);
    if (lo >= hi) continue;
    float den = sb - sa;
    float ta = abs(den) > 1e-6 ? (lo - sa) / den : 0.0;
    float tb = abs(den) > 1e-6 ? (hi - sa) / den : 1.0;
    vec3 a = mix(A.xyz, Bq.xyz, ta);
    vec3 b = mix(A.xyz, Bq.xyz, tb);
    vec3 L0 = a - s.P;
    vec3 Ld = b - a;
    float len = length(Ld);
    if (len < 1e-5) continue;
    vec3 u = Ld / len;
    float bb = dot(L0, u);
    float cc = dot(L0, L0) + 0.000016;
    float D = max(cc - bb * bb, 1e-7);
    if (D > 0.09) continue;                 // farther than 30 cm: negligible
    float q0 = cc;
    float q1 = len * len + 2.0 * bb * len + cc;
    float al = dot(s.N, L0);
    float be = dot(s.N, u);
    float F1 = (len + bb) / (D * sqrt(q1)) - bb / (D * sqrt(q0));
    float F2 = -(bb * len + cc) / (D * sqrt(q1)) + cc / (D * sqrt(q0));
    float E = max(al * F1 + be * F2, 0.0);
    vec3 I = uSeamColor * st.z;
    acc += s.diff / PI * I * E;
    // specular: closest point on the segment to the reflection ray
    float RoLd = dot(R, Ld), RoL0 = dot(R, L0), L0oLd = dot(L0, Ld);
    float t = clamp((RoL0 * RoLd - L0oLd) / (len * len - RoLd * RoLd + 1e-7), 0.0, 1.0);
    vec3 Lp = L0 + t * Ld;
    float dl = length(Lp);
    vec3 L = Lp / dl;
    float NoL = max(dot(s.N, L), 0.0);
    if (NoL > 0.0) {
      float wEff = min(len, (2.0 * s.a + 0.015) * dl);
      float aP = clamp(s.a + 0.004 / dl, 0.0, 1.0);
      acc += specBRDF(s, L, NoL) * NoL * I * wEff / (dl * dl) * (s.a / aP) * uSeamSpec;
    }
  }
  return acc;
}

vec3 envRadiance(vec3 R, float rough){
  float up = smoothstep(-0.4, 0.9, R.y);
  vec3 c = mix(vec3(0.010, 0.010, 0.012), vec3(0.06, 0.056, 0.052), up);
  // faint crimson from behind (rim side)
  c += vec3(0.05, 0.004, 0.003) * smoothstep(0.1, -0.9, R.z) * smoothstep(-0.2, 0.6, R.y);
  return c * uAmbTint;
}

void main() {
  Surf s;
  s.P = vPos;
  s.V = normalize(cameraPosition - vPos);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  s.N = N;
  vec3 T = vT - N * dot(vT, N);
  T = dot(T, T) > 1e-6 ? normalize(T) : normalize(cross(N, vec3(0.0, 1.0, 0.001)));
  s.T = T;
  s.B = cross(N, T);

  float ao = vBake.x;
  float edge = smoothstep(0.08, 0.5, vCurv) * uEdge;
  float crev = smoothstep(0.75, 0.3, ao);

  // brushed streaks: fast across the brushing direction, slow along it
  vec3 P = vPos;
  float across = dot(P, s.B) * 520.0;
  float along = dot(P, s.T) * 14.0;
  float streak = vnoise(vec3(across, along, 0.5)) * 0.6 + vnoise(vec3(across * 0.31, along * 0.4, 3.7)) * 0.4;
  float smudge = fbm3(P * 9.0);

  float rough = uRough * (1.0 + uStreak * (streak - 0.5) * 0.5) * (0.93 + 0.14 * smudge);
  rough = mix(rough, rough * 0.55, edge);
  rough = mix(rough, min(1.0, rough * 1.35), crev * 0.6);
  rough = clamp(rough, 0.03, 1.0);
  float a = rough * rough;
  s.a = a;
  s.at = clamp(a * (1.0 + 1.6 * uAniso), 0.002, 1.0);
  s.ab = clamp(a * (1.0 - 0.45 * uAniso), 0.002, 1.0);
  vec3 f0 = uF0 * (1.0 + uStreak * (streak - 0.5) * 0.18);
  f0 = mix(f0, min(vec3(1.0), f0 * 1.45 + 0.03), edge);
  f0 *= mix(1.0, 0.75, crev);
  s.f0 = f0;
  s.diff = uDiffuse * mix(1.0, 0.7, crev);

  vec3 col = vec3(0.0);
  float rimFall = smoothstep(uRimFloor, uRimFloor + 0.55, vPos.y);
  col += rectLight(s, uKeyC, uKeyU, uKeyW, uKeyRad, vBake.y);
  col += rectLight(s, uRimRC, uRimRU, uRimRW, uRimRRad * rimFall, vBake.z);
  col += rectLight(s, uRimLC, uRimLU, uRimLW, uRimLRad * rimFall, vBake.w);
  col += rectLight(s, uFillC, uFillU, uFillW, uFillRad, mix(1.0, ao, 0.7));
  col += rectLight(s, uTopC, uTopU, uTopW, uTopRad, mix(1.0, ao, 0.85) * smoothstep(0.05, 0.25, vPos.y));
  col += seamLights(s) * mix(0.55, 1.0, ao);

  // ambient
  vec3 R = reflect(-s.V, s.N);
  float NoV = max(dot(s.N, s.V), 1e-4);
  vec3 Fa = s.f0 + (max(vec3(1.0 - rough), s.f0) - s.f0) * pow(1.0 - NoV, 5.0);
  col += (envRadiance(R, rough) * Fa + s.diff * envRadiance(s.N, 1.0)) * uAmb * ao * ao;

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------ seams ---- */

export const seamVert = /* glsl */ `
attribute float aS;
varying float vS;
varying vec3 vPos;
varying vec3 vN;
void main(){
  vS = aS;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const seamFrag = /* glsl */ `
precision highp float;
uniform vec4 uState;      // s0, s1, intensity, front glow
uniform vec3 uColor;
varying float vS;
varying vec3 vPos;
varying vec3 vN;
void main(){
  float lit = smoothstep(uState.x - 0.015, uState.x + 0.005, vS) * (1.0 - smoothstep(uState.y - 0.004, uState.y + 0.03, vS));
  float front = exp(-pow((vS - uState.y) / 0.05, 2.0)) * uState.w;
  vec3 V = normalize(cameraPosition - vPos);
  float core = pow(max(dot(normalize(vN), V), 0.0), 0.6);
  vec3 c = uColor * uState.z * lit * (0.55 + 0.45 * core) + vec3(1.0, 0.98, 0.95) * front * uState.z * 1.4;
  gl_FragColor = vec4(c, 1.0);
}
`;

/* -------------------------------------------------------- background ---- */

export const bgFrag = /* glsl */ `
precision highp float;
${common}
uniform vec2 uRes;
uniform float uTime;
uniform float uRimR;
uniform float uRimL;
uniform float uKey;
uniform vec2 uHead;     // screen position of the head (0..1)
uniform float uScale;   // screen size of the bust (fraction of height)
varying vec2 vUv;
void main(){
  vec2 p = (vUv - uHead) * vec2(uRes.x / uRes.y, 1.0) / uScale;
  float n = fbm3(vec3(p * 1.6 + vec2(uTime * 0.012, -uTime * 0.02), uTime * 0.03));
  float n2 = fbm3(vec3(p * 3.4 - vec2(uTime * 0.02, uTime * 0.01), 7.0 + uTime * 0.05));
  float haze = 0.55 + 0.75 * n * n2;
  // glow pooled behind the shoulders on each rim side
  float gR = exp(-dot(p - vec2(0.62, 0.42), p - vec2(0.62, 0.42)) / 0.55);
  float gL = exp(-dot(p - vec2(-0.62, 0.38), p - vec2(-0.62, 0.38)) / 0.55);
  float gC = exp(-dot(p - vec2(0.0, 0.3), p - vec2(0.0, 0.3)) / 1.1);
  vec3 crimson = vec3(0.30, 0.018, 0.012);
  vec3 c = crimson * (gR * uRimR + gL * uRimL * 0.8) * 0.075 * haze;
  c += crimson * gC * (uRimR + uRimL) * 0.03 * haze;
  c += vec3(0.020, 0.019, 0.018) * gC * uKey * haze;
  c += vec3(0.0010, 0.0009, 0.0010);
  gl_FragColor = vec4(c, 1.0);
}
`;
export const fsVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* --------------------------------------------------------- particles ---- */

export const dustVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPx;          // pixels per unit of CoC
uniform float uFocus;
uniform float uRimR; uniform float uRimL; uniform float uKey; uniform float uSeamGlow;
uniform vec3 uRimRC; uniform vec3 uRimLC;
varying float vAlpha;
varying float vSize;
varying vec3 vCol;
void main(){
  vec3 p = position;
  p += vec3(0.008, 0.012, 0.004) * uTime * (0.5 + aSeed.x);
  p.x += 0.02 * sin(uTime * 0.21 + aSeed.y * 6.28);
  p.y += 0.015 * sin(uTime * 0.17 + aSeed.z * 6.28);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float coc = abs(1.0 / uFocus - 1.0 / d) * uPx;
  float size = max(1.6, coc + 1.4 + aSeed.w * 1.2);
  vec3 V = normalize(cameraPosition - p);
  // forward scattering of the back lights (Henyey-Greenstein, g = 0.65)
  float g = 0.65;
  vec3 lR = normalize(p - uRimRC);
  vec3 lL = normalize(p - uRimLC);
  float cR = dot(lR, V), cL = dot(lL, V);
  float hgR = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cR, 1.5);
  float hgL = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cL, 1.5);
  // the bust shadows motes that sit in front of it
  float behind = smoothstep(0.38, 0.22, length((p.xy - vec2(0.0, 0.05)) * vec2(1.0, 0.75))) * step(0.0, p.z);
  vec3 crimson = vec3(1.0, 0.06, 0.035);
  vec3 col = crimson * (hgR * uRimR + hgL * uRimL * 0.7) * (1.0 - behind * 0.85) * 0.16;
  col += vec3(0.75, 0.9, 1.0) * uSeamGlow * exp(-dot(p - vec3(0.0, 0.0, 0.1), p - vec3(0.0, 0.0, 0.1)) / 0.08) * 0.35;
  col += vec3(1.0, 0.95, 0.88) * uKey * 0.05;
  col *= 0.35 + 1.3 * aSeed.x * aSeed.x;
  vCol = col;
  vSize = size;
  vAlpha = min(1.0, 6.0 / (size * size));
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}
`;
export const dustFrag = /* glsl */ `
precision highp float;
varying float vAlpha;
varying float vSize;
varying vec3 vCol;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  float soft = 1.5 / vSize;
  float disc = 1.0 - smoothstep(1.0 - soft * 2.0, 1.0, r);
  float ring = smoothstep(0.55, 0.95, r) * 0.35 * smoothstep(6.0, 14.0, vSize);
  float core = vSize < 4.0 ? exp(-r * r * 3.0) : disc * (0.8 + ring);
  gl_FragColor = vec4(vCol * core * vAlpha, 1.0);
}
`;

/* ------------------------------------------------------------- final ---- */

export const finalFrag = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uExposure;
uniform float uFrame;
uniform float uGrain;
uniform float uCA;
varying vec2 vUv;

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// ACES fitted (Stephen Hill)
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = i * c; c = RRTAndODTFit(c); c = o * c; return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc * vec2(uRes.x / uRes.y, 1.0), dc * vec2(uRes.x / uRes.y, 1.0));
  vec2 off = dc * r2 * uCA;
  vec3 c;
  c.r = texture2D(tDiffuse, uv - off).r;
  c.g = texture2D(tDiffuse, uv).g;
  c.b = texture2D(tDiffuse, uv + off).b;
  c *= uExposure;
  // vignette (in light, before the curve)
  float vig = 1.0 - 0.38 * smoothstep(0.15, 1.05, r2);
  c *= vig;
  c = aces(c);
  // grade: gentle warm highlights, neutral-cool shadows, soft lifted toe
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.96);
  c *= mix(vec3(0.985, 0.995, 1.02), vec3(1.03, 1.0, 0.965), smoothstep(0.05, 0.6, l));
  c = c * (1.0 - 0.012) + 0.012 * smoothstep(0.0, 0.08, c) * 0.0 + 0.004;
  vec3 s = toSRGB(clamp(c, 0.0, 1.0));
  // film grain (luminance weighted) + dither
  float g = h12(gl_FragCoord.xy + uFrame * 37.17) + h12(gl_FragCoord.xy * 1.37 + uFrame * 11.3) - 1.0;
  float ls = dot(s, vec3(0.333));
  s += g * uGrain * (0.35 + 0.65 * (1.0 - abs(ls - 0.35) * 1.4));
  s += (h12(gl_FragCoord.xy + 0.5 + uFrame) - 0.5) / 255.0;
  gl_FragColor = vec4(s, 1.0);
}
`;
