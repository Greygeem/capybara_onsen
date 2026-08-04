import { Vector2 } from 'three';

/**
 * Fullscreen shader pass: ordered dithering + palette quantization + edge outlines.
 * Designed to run AFTER OutputPass (operates in sRGB space).
 */
export const PaletteQuantizeShader = {
  name: 'PaletteQuantizeShader',
  uniforms: {
    tDiffuse: { value: null },
    palette: { value: [] },
    paletteSize: { value: 0 },
    ditherStrength: { value: 0.06 },
    outlineStrength: { value: 0.45 },
    pixelSize: { value: 6.0 },
    resolution: { value: new Vector2(1280, 720) },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform vec3 palette[32];
    uniform int paletteSize;
    uniform float ditherStrength;
    uniform float outlineStrength;
    uniform float pixelSize;
    uniform vec2 resolution;

    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      // ── 1. Edge detection (color-based, at block level) ──
      vec2 blockStep = vec2(pixelSize) / resolution;
      vec3 cL = texture2D(tDiffuse, vUv - vec2(blockStep.x, 0.0)).rgb;
      vec3 cR = texture2D(tDiffuse, vUv + vec2(blockStep.x, 0.0)).rgb;
      vec3 cU = texture2D(tDiffuse, vUv + vec2(0.0, blockStep.y)).rgb;
      vec3 cD = texture2D(tDiffuse, vUv - vec2(0.0, blockStep.y)).rgb;

      float edgeH = length(cL - cR);
      float edgeV = length(cU - cD);
      float edge = max(edgeH, edgeV);

      // Darken edge pixels (object's own dark tone, not black)
      if (edge > 0.12) {
        color *= outlineStrength;
      }

      // ── 2. Bayer 4x4 ordered dithering (at block level) ──
      vec2 blockCoord = floor(gl_FragCoord.xy / pixelSize);
      vec2 p = floor(mod(blockCoord, 4.0));

      // Column-major mat4 encoding of Bayer 4x4
      mat4 bayer = mat4(
         0.0/16.0, 12.0/16.0,  3.0/16.0, 15.0/16.0,
         8.0/16.0,  4.0/16.0, 11.0/16.0,  7.0/16.0,
         2.0/16.0, 14.0/16.0,  1.0/16.0, 13.0/16.0,
        10.0/16.0,  6.0/16.0,  9.0/16.0,  5.0/16.0
      );
      float dither = (bayer[int(p.x)][int(p.y)] - 0.5) * ditherStrength;
      color = clamp(color + dither, 0.0, 1.0);

      // ── 3. Snap to nearest palette color ──
      float minDist = 1e6;
      vec3 nearest = palette[0];
      for (int i = 0; i < 32; i++) {
        if (i >= paletteSize) break;
        vec3 diff = color - palette[i];
        float d = dot(diff, diff);
        if (d < minDist) {
          minDist = d;
          nearest = palette[i];
        }
      }

      gl_FragColor = vec4(nearest, texel.a);
    }
  `,
};
