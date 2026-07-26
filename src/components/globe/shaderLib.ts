/**
 * Shared GLSL. Small enough to read in one sitting, which is the point —
 * every surface on this globe is lit by the same sun with the same falloff, and
 * that consistency is what makes it read as one physical object rather than
 * four layers pretending.
 */

/**
 * Horizon visibility for a point on the sphere.
 *
 * A surface point with outward normal `n` is visible from a camera at distance
 * `d` exactly when `dot(n, normalize(camPos)) > radius / d`. That is the true
 * tangent condition, not an approximation — which matters for the flat surface
 * decorations (glow discs, pulse rings), because a disc that keeps drawing past
 * the limb pops out from behind the planet's edge.
 */
export const HORIZON_GLSL = /* glsl */ `
float horizonVisibility(vec3 n, vec3 camPos, float radius, float softness) {
  float d = length(camPos);
  float cutoff = radius / max(d, 1e-4);
  return smoothstep(cutoff - softness, cutoff + softness, dot(n, camPos / max(d, 1e-4)));
}
`;

/**
 * Day/night response, shared by the ocean, the land and the line layers.
 *
 * `sun` is dot(normal, sunDirection).
 *   - `day`  eases from full night to full day across a band centred slightly
 *     on the night side, standing in for atmospheric scattering at dusk.
 *   - `dusk` is a narrow Gaussian at the terminator itself. This is the whole
 *     trick: a thin warm line where the light is grazing, which is what makes
 *     an unlit ball read as a planet.
 */
export const DAYNIGHT_GLSL = /* glsl */ `
float dayFactor(float sun) {
  return smoothstep(-0.20, 0.32, sun);
}
float duskBand(float sun, float width) {
  float t = sun / width;
  return exp(-t * t);
}
`;

/**
 * Cheap 3D value noise. Used only to give the night side uneven warm patches —
 * the impression of settlement without shipping a light-pollution raster. Two
 * octaves, low amplitude; if you can identify it as noise, it is turned up too
 * far.
 */
export const VALUE_NOISE_GLSL = /* glsl */ `
float vnHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(vnHash(i + vec3(0,0,0)), vnHash(i + vec3(1,0,0)), f.x),
        mix(vnHash(i + vec3(0,1,0)), vnHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(vnHash(i + vec3(0,0,1)), vnHash(i + vec3(1,0,1)), f.x),
        mix(vnHash(i + vec3(0,1,1)), vnHash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

/** Standard trailer for a custom fragment shader: tone map, then encode. */
export const OUTPUT_GLSL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/**
 * Vertex shader shared by every sphere-conforming layer. Emits world-space
 * position and normal; on a sphere centred at the origin the normal *is* the
 * normalised position, so line geometry (which carries no normal attribute)
 * can use `vWorldPos` directly.
 */
export const SURFACE_VERTEX_GLSL = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
