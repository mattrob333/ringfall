// L4 fx — GLSL for the two pooled draws (particles, decals).
//
// ART.md §2: every shape below is ANALYTIC. There is no sampler2D of any kind
// in this file, no noise function, and no term whose spatial frequency is
// unbounded. Shapes are antialiased against fwidth() exactly the way
// src/materials/index.js antialiases its panel and bolt masks.
//
// Blending is PREMULTIPLIED for both draws:
//   additive pool : blend (ONE, ONE)                  — order independent
//   alpha pool    : blend (ONE, ONE_MINUS_SRC_ALPHA)  — depth sorted on the CPU
//   decal pool    : blend (ONE, ONE_MINUS_SRC_ALPHA)
// so the fragment shader always writes vec4(rgb * a, a).

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

export const PARTICLE_VERT = /* glsl */ `
  precision highp float;

  in vec3 iPos;
  in vec3 iVel;
  in vec4 iParams;   // x size, y rotation, z shape, w streak length (metres)
  in vec4 iColor;    // rgb linear HDR (already scaled by intensity), a coverage

  out vec2 vUv;      // -1..1 across the quad
  out vec4 vColor;
  out float vSeed;
  flat out float vShape;

  void main() {
    vUv = position.xy * 2.0;
    vColor = iColor;
    vShape = iParams.z;
    vSeed = iParams.y;

    // Camera basis straight out of the view matrix rows. Cheaper and more
    // robust than reconstructing from cameraPosition for a degenerate look-at.
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    float size = iParams.x;
    float streak = iParams.w;
    vec3 offset;

    if (streak > 0.0) {
      // Velocity-aligned billboard. The quad trails BEHIND the particle so a
      // tracer's head sits on the ray rather than straddling it.
      vec3 toCam = cameraPosition - iPos;
      float dc = length(toCam);
      toCam = dc > 1e-5 ? toCam / dc : camUp;

      vec3 dir = iVel;
      float sp = length(dir);
      dir = sp > 1e-4 ? dir / sp : camUp;

      vec3 side = cross(dir, toCam);
      float sl = length(side);
      side = sl > 1e-4 ? side / sl : camRight;
      vec3 along = normalize(cross(toCam, side));

      offset = along * (position.y * streak - streak * 0.5) + side * (position.x * size);
    } else {
      float c = cos(iParams.y);
      float s = sin(iParams.y);
      vec2 r = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      offset = (camRight * r.x + camUp * r.y) * size;
    }

    gl_Position = projectionMatrix * viewMatrix * vec4(iPos + offset, 1.0);
  }
`;

export const PARTICLE_FRAG = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  in vec4 vColor;
  in float vSeed;
  flat in float vShape;

  layout(location = 0) out vec4 fragColor;

  // --- Analytic shapes. No textures, no noise. ------------------------------

  float softDisc(vec2 p) {
    float f = clamp(1.0 - length(p), 0.0, 1.0);
    return f * f;
  }

  float ringShape(vec2 p) {
    float d = length(p);
    float x = (d - 0.72) / 0.17;
    return exp(-x * x * 2.2) * (1.0 - smoothstep(0.90, 1.02, d));
  }

  float streakShape(vec2 p) {
    float ax = clamp(1.0 - abs(p.x), 0.0, 1.0);
    float ay = clamp(1.0 - abs(p.y), 0.0, 1.0);
    return ax * ax * ay;
  }

  float sparkShape(vec2 p) {
    float d = length(p);
    float core = 1.0 - smoothstep(0.0, 0.30, d);
    float halo = exp(-d * 3.4) * 0.38;
    return clamp(core + halo, 0.0, 1.0) * (1.0 - smoothstep(0.88, 1.0, d));
  }

  // SHIELD / ENERGY_BARRIER: a sheet of radial arcs plus a rim. Six spokes at a
  // fixed angular frequency — bounded, not noise.
  float crackleShape(vec2 p, float seed) {
    float d = length(p);
    float ang = atan(p.y, p.x);
    float sp = abs(sin(ang * 6.0 + seed * 6.2831853));
    float spokes = pow(sp, 7.0);
    float rim = exp(-pow((d - 0.80) / 0.20, 2.0) * 2.0);
    float body = clamp(1.0 - d, 0.0, 1.0);
    return clamp(spokes * body * 1.10 + rim * 0.55, 0.0, 1.0);
  }

  // GLASS: a hard-edged triangle built from three half planes, antialiased with
  // fwidth() so it stays crisp at range instead of shimmering.
  float shardShape(vec2 p, float seed) {
    float a0 = seed * 6.2831853;
    vec2 n0 = vec2(cos(a0), sin(a0));
    vec2 n1 = vec2(cos(a0 + 2.0943951), sin(a0 + 2.0943951));
    vec2 n2 = vec2(cos(a0 + 4.1887902), sin(a0 + 4.1887902));
    float sd = max(max(dot(p, n0), dot(p, n1)), dot(p, n2)) - 0.55;
    float aa = fwidth(p.x) * 1.2 + 1e-4;
    return 1.0 - smoothstep(-aa, aa, sd);
  }

  // Expanding shell: a bright thin rim with a faint interior.
  float shellShape(vec2 p) {
    float d = length(p);
    float rim = 1.0 - smoothstep(0.0, 0.15, abs(d - 0.85));
    float inner = clamp(1.0 - d, 0.0, 1.0) * 0.16;
    return clamp(rim * 0.95 + inner, 0.0, 1.0) * (1.0 - smoothstep(0.98, 1.08, d));
  }

  void main() {
    vec2 p = vUv;
    float a;
    if (vShape < 0.5)      a = softDisc(p);
    else if (vShape < 1.5) a = ringShape(p);
    else if (vShape < 2.5) a = streakShape(p);
    else if (vShape < 3.5) a = sparkShape(p);
    else if (vShape < 4.5) a = crackleShape(p, vSeed);
    else if (vShape < 5.5) a = shardShape(p, vSeed);
    else                   a = shellShape(p);

    a *= vColor.a;
    if (a <= 0.0021) discard;
    fragColor = vec4(vColor.rgb * a, a);
  }
`;

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------

export const DECAL_VERT = /* glsl */ `
  precision highp float;

  in vec3 dPos;
  in vec3 dNormal;
  in vec4 dParams;  // x size, y rotation, z pattern, w seed
  in vec4 dColor;   // rgb linear, a coverage

  out vec2 vUv;
  out vec4 vColor;
  out float vSeed;
  flat out float vPattern;

  void main() {
    vUv = position.xy * 2.0;
    vColor = dColor;
    vPattern = dParams.z;
    vSeed = dParams.w;

    vec3 n = normalize(dNormal);
    vec3 up = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    vec3 b = cross(n, t);

    float c = cos(dParams.y);
    float s = sin(dParams.y);
    vec3 T = t * c + b * s;
    vec3 B = -t * s + b * c;

    // 1.2 cm along the normal. Enough to clear depth precision at our near
    // plane (0.05 m) without the quad visibly floating at grazing angles.
    vec3 wp = dPos + n * 0.012 + (T * position.x + B * position.y) * dParams.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

export const DECAL_FRAG = /* glsl */ `
  precision highp float;

  in vec2 vUv;
  in vec4 vColor;
  in float vSeed;
  flat in float vPattern;

  layout(location = 0) out vec4 fragColor;

  float aaStep(float edge, float x) {
    float aa = fwidth(x) * 0.9 + 1e-4;
    return 1.0 - smoothstep(edge - aa, edge + aa, x);
  }

  // Low-order harmonic radius modulation. Two cosine terms only: an irregular
  // outline that is still bounded well under ART.md §2's frequency cap.
  float lobedRadius(float ang, float seed, float amp) {
    return 1.0 + amp * (cos(ang * 3.0 + seed * 6.283) * 0.6 + cos(ang * 5.0 - seed * 4.1) * 0.4);
  }

  float radialSpokes(float ang, float n, float seed, float sharp) {
    return pow(abs(sin(ang * n + seed * 6.2831853)), sharp);
  }

  void main() {
    vec2 p = vUv;
    float d = length(p);
    float ang = atan(p.y, p.x);
    float a = 0.0;

    if (vPattern < 0.5) {
      // METAL — a dark crater with a bright-ish rim and five scratch spokes.
      float crater = aaStep(0.34, d);
      float rim = 1.0 - smoothstep(0.0, 0.10, abs(d - 0.40));
      float spokes = radialSpokes(ang, 2.5, vSeed, 9.0) * aaStep(0.95, d) * (1.0 - aaStep(0.30, d));
      a = clamp(crater * 0.95 + rim * 0.45 + spokes * 0.55, 0.0, 1.0);
    } else if (vPattern < 1.5) {
      // STONE (concrete / rock) — irregular chipped patch, darker core.
      float r = lobedRadius(ang, vSeed, 0.22);
      float body = aaStep(r * 0.72, d);
      float core = aaStep(r * 0.30, d);
      a = clamp(body * 0.55 + core * 0.55, 0.0, 1.0);
    } else if (vPattern < 2.5) {
      // SOFT (dirt / grass / sand) — a scatter blob, no rim, soft edge.
      float r = lobedRadius(ang, vSeed, 0.18);
      a = pow(clamp(1.0 - d / max(r * 0.9, 1e-3), 0.0, 1.0), 1.4);
    } else if (vPattern < 3.5) {
      // GLASS — hole, radial crack star, one concentric ring.
      float hole = aaStep(0.20, d);
      float cracks = radialSpokes(ang, 4.0, vSeed, 22.0) * aaStep(0.98, d);
      float ring = 1.0 - smoothstep(0.0, 0.045, abs(d - 0.55));
      a = clamp(hole * 0.9 + cracks * 0.85 + ring * 0.35, 0.0, 1.0);
    } else if (vPattern < 4.5) {
      // ALLOY_SMOOTH (Vess) — a clean scorch ring. No panels, no chips: the
      // shell is a single continuous form (ART.md §3.3) and marks it that way.
      float ring = 1.0 - smoothstep(0.0, 0.13, abs(d - 0.62));
      float core = aaStep(0.26, d);
      a = clamp(ring * 0.7 + core * 0.8, 0.0, 1.0);
    } else if (vPattern < 5.5) {
      // ALLOY_HARD (Wrought) — hard hexagonal scorch, large radius motif.
      float hex = 0.0;
      for (int i = 0; i < 3; i++) {
        float t = float(i) * 1.0471976 + vSeed * 6.2831853;
        hex = max(hex, abs(dot(p, vec2(cos(t), sin(t)))));
      }
      float aa = fwidth(p.x) * 1.1 + 1e-4;
      a = (1.0 - smoothstep(0.62 - aa, 0.62 + aa, hex)) * 0.95;
    } else {
      // SCORCH — blast mark. Large, soft-edged, faintly lobed.
      float r = lobedRadius(ang, vSeed, 0.14);
      a = pow(clamp(1.0 - d / max(r * 0.98, 1e-3), 0.0, 1.0), 0.85);
    }

    a *= vColor.a;
    if (a <= 0.0021) discard;
    fragColor = vec4(vColor.rgb * a, a);
  }
`;
