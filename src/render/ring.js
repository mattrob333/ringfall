// L2 render — the ring arc. OWNER: `lighting` (S1). ART.md §3.1 / P12.
//
// Lives in src/render, not src/world, because it is rendered inside the sky
// pass and src/render (L2) may not import src/world (L4). It is sky, not level.
//
// The strongest silhouette cue in the game, and mandatory in every exterior shot.
//
// It is rendered ANALYTICALLY inside the sky pass rather than as geometry.
// Reason, measured: the ring's nearest point is 3.5 km out and its far side is
// 24 km up. camera.far is 4000 m, so a real mesh was entirely clipped away and
// the first capture had no ring at all. The alternatives were:
//   - raise camera.far to 60 km  -> destroys depth precision across the whole
//     playable area, for one object
//   - shrink and dolly the ring in -> parallax then reads as a nearby prop
//   - draw it in the sky pass     -> no far plane involved, exact perspective,
//     and terrain still occludes it because the sky pass is depth tested
// Over a 420 m arena the translation parallax of a 12 km object is under
// 0.02 deg, so treating the camera as fixed at the origin is not an approximation
// anyone can see.

export const RING_RADIUS = 12000;
// 2900 m put the band across ~30% of the frame — a wall, not a horizon feature.
// 1150 m lands it near 10%, comfortably above ART.md P12's 4% floor while
// leaving the sky as the dominant element.
export const RING_WIDTH = 1150;

/**
 * Ray/ring intersection in the sky shader.
 *
 * The band is a cylinder of radius R about the axis line {(u, R, 0)}, clipped
 * to |u| <= W/2. The player stands on the inner surface at the origin, so the
 * far side of the ring passes directly overhead at height 2R.
 */
export const RING_GLSL = /* glsl */ `
  uniform float uRingRadius;
  uniform float uRingWidth;
  uniform vec3  uRingLand;
  uniform vec3  uRingSea;
  uniform vec3  uRingRim;
  uniform float uRingHaze;

  float ringBand(float x, float c, float w) {
    return smoothstep(w, 0.0, abs(x - c));
  }

  // Returns rgb in .xyz and coverage in .w
  vec4 ringArc(vec3 dir, vec3 origin) {
    float R = uRingRadius;
    // Solve |(O + t*d) - axis|^2 = R^2 in the YZ plane (axis is +X at y = R).
    vec2 o = vec2(origin.y - R, origin.z);
    vec2 d = vec2(dir.y, dir.z);
    float a = dot(d, d);
    if (a < 1e-8) return vec4(0.0);
    float b = 2.0 * dot(o, d);
    float c = dot(o, o) - R * R;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) return vec4(0.0);
    float sq = sqrt(disc);
    float t0 = (-b - sq) / (2.0 * a);
    float t1 = (-b + sq) / (2.0 * a);
    float t = t0 > 1.0 ? t0 : t1;
    if (t <= 1.0) return vec4(0.0);

    vec3 P = origin + dir * t;

    // Across-band coordinate.
    float u = P.x / (uRingWidth * 0.5);
    if (abs(u) > 1.0) return vec4(0.0);
    float across = u * 0.5 + 0.5;

    // Angle around the ring. Near t = 0 we are looking at the ground we stand
    // on, so that arc is suppressed and the real terrain takes over.
    // Angle around the ring. Near ang = 0 we are looking at the ground we are
    // standing on, so that arc is suppressed and the real terrain takes over.
    // The fade-in is pushed out to 0.28-0.80 rad so the band emerges from
    // behind the horizon haze rather than flaring up out of the player's feet.
    float ang = atan(P.z, R - P.y);
    float rise = smoothstep(0.28, 0.80, abs(ang));
    if (rise <= 0.0) return vec4(0.0);

    // Inward normal points at the ring axis.
    vec3 N = normalize(vec3(0.0, R - P.y, -P.z));

    float rim = smoothstep(0.06, 0.0, across) + smoothstep(0.94, 1.0, across);
    vec3 col = mix(uRingLand, uRingSea, ringBand(across, 0.40, 0.15) * 0.9);
    col = mix(col, uRingLand * 1.20, ringBand(across, 0.71, 0.12));
    col = mix(col, uRingSea * 0.82, ringBand(across, 0.20, 0.08));

    float along = ang * 3.0;
    float v = sin(along * 5.1) * 0.5 + sin(along * 2.3) * 0.35 + sin(along * 0.9) * 0.15;
    col *= 1.0 + v * 0.12;
    col = mix(col, uRingRim, clamp(rim, 0.0, 1.0));

    float NdotL = max(dot(N, uSunDir), 0.0);
    vec3 lit = col * (uSunColor * NdotL * INV_PI + max(shIrradiance(N), vec3(0.0)) * 0.6);

    // Fixed atmospheric wash toward the sky, heavier near the horizon where the
    // ring is seen through the most air. ART.md P12 needs it to stay >= dE 10
    // from the sky, so this is capped rather than a full fog integral.
    float horizonWash = mix(0.78, uRingHaze, smoothstep(0.25, 1.10, abs(ang)));
    lit = mix(lit, skyRadiance(dir), horizonWash);

    return vec4(lit, rise);
  }
`;
