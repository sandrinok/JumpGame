import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { QualitySettings } from './quality';

/** Half-size of the sun's shadow frustum, in world units, around the focus point. */
const SHADOW_EXTENT = 22;

/**
 * Direction the sunlight comes from. The sky shader and the shadow-casting
 * light both derive from this, so the bright spot in the sky is where the
 * shadows say it is.
 */
const SUN_DIRECTION = new THREE.Vector3(0.5, 0.4, 0.32).normalize();
/** How far the shadow light sits from its focus point along that direction. */
const SUN_DISTANCE = 90;
const SUN_OFFSET = SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE);

/**
 * How far the sky dome sits from the camera. Comfortably inside the camera's
 * far plane (1000) so it is never clipped, and well beyond the 400-unit ground
 * so nothing pokes through it.
 */
const SKY_RADIUS = 900;

/** Cloud deck: high enough to read as sky, inside the camera's far plane. */
const CLOUD_ALTITUDE = 165;
const CLOUD_SPAN = 1500;
/** World units per second the deck drifts. Barely perceptible on purpose. */
const CLOUD_DRIFT = 0.45;

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** Advance the cloud drift. Call once per rendered frame. */
  updateSky(dt: number): void;
}

export function createScene(
  renderer: THREE.WebGLRenderer,
  quality: QualitySettings,
): SceneSetup {
  const scene = new THREE.Scene();

  const sky = new Sky();
  sky.scale.setScalar(SKY_RADIUS);
  const u = sky.material.uniforms;
  // Clear late-morning air: low turbidity keeps the blue saturated instead of
  // hazy, and a gentle mie term stops the sun blowing into a white disc.
  u.turbidity.value = 2.5;
  u.rayleigh.value = 2.6;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.75;
  u.sunPosition.value.copy(SUN_DIRECTION);

  /*
   * Light the scene with the sky itself.
   *
   * This is the change that matters most visually. Until now every surface was
   * lit by two directional lights and a hemisphere term, with nothing to
   * reflect — so metal read as flat grey and everything looked like untextured
   * clay. An environment map gives each material something to mirror, which is
   * what PBR shading is built around. Rendering the sky into it also means the
   * ambient colour agrees with the sky you can see: cool blue from above, warm
   * near the sun.
   */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // Re-parent out of the throwaway env scene into the real one.
  scene.add(sky);

  // Fog tinted towards the sky's horizon so distant ground dissolves into it
  // rather than ending on a hard line.
  scene.fog = new THREE.Fog(0xbcd3e8, 140, 460);

  // Much weaker than before: the environment map now supplies ambient light,
  // and stacking the old hemisphere term on top just washed out the shading.
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x2a2820, 0.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = 250;
  cam.updateProjectionMatrix();
  // Enough bias to kill acne on the big flat ground, small enough that the
  // character's contact shadow stays attached to its feet — that shadow is the
  // cue you judge a landing by.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const clouds = createCloudDeck();
  scene.add(clouds);

  return {
    scene,
    sun,
    updateSky(dt) {
      clouds.position.x += CLOUD_DRIFT * dt;
      // Wrap on the texture's world period so the drift never runs away and
      // the seam never arrives.
      if (clouds.position.x > CLOUD_SPAN) clouds.position.x -= CLOUD_SPAN;
    },
  };
}

/**
 * A single transparent quad standing in for a cloud layer.
 *
 * One draw call and no per-frame work beyond a position nudge, which is what
 * makes it affordable — particles or volumetrics would cost real frame time
 * for something you glance at. The texture carries its own radial alpha
 * falloff so the quad has no visible edge; without it the deck ends in a hard
 * line across the sky.
 */
function createCloudDeck(): THREE.Mesh {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  let seed = 20260725;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Clumps of overlapping soft discs: cheap cumulus. Larger, sparser blobs
  // first, then smaller ones packed around them so edges look eroded rather
  // than like a row of circles.
  for (const [clumps, puffs, spread, radius, alpha] of [
    [7, 26, 150, 62, 0.13],
    [11, 20, 95, 38, 0.115],
    [16, 14, 55, 20, 0.1],
  ] as const) {
    for (let c = 0; c < clumps; c++) {
      const cx = rand() * size;
      const cy = rand() * size;
      for (let p = 0; p < puffs; p++) {
        const x = cx + (rand() - 0.5) * spread;
        const y = cy + (rand() - 0.5) * spread * 0.55;
        const r = radius * (0.55 + rand() * 0.75);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.5})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Radial falloff so the quad dissolves before its own border.
  ctx.globalCompositeOperation = 'destination-in';
  // Hold full opacity well out towards the rim: the visible band of sky starts
  // only ~25 degrees up, and a fade that begins near the centre leaves clouds
  // visible nowhere except straight overhead.
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.34, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.6, 'rgba(0,0,0,0.7)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CLOUD_SPAN, CLOUD_SPAN),
    new THREE.MeshBasicMaterial({
      map: texture,
      // Deliberately above 1. Post-processing renders everything into a linear
      // HDR buffer and tone maps at the end, so plain white is only 1.0 of
      // radiance — dimmer than the sky shader behind it, which made the clouds
      // read as faint grey smudges or vanish entirely. This puts them above
      // the sky so they read as lit cloud.
      color: new THREE.Color(3.4, 3.4, 3.5),
      transparent: true,
      depthWrite: false,
      // Unlit and unfogged: clouds are sky, not geometry sitting in the haze.
      fog: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = CLOUD_ALTITUDE;
  // Drawn after the sky dome, before everything solid.
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Keep the shadow frustum centred on the player. A directional light covering
 * the whole 400x400 world would need a frustum so large that the shadow under
 * the character — the one telling you where you will land — would be a couple
 * of texels wide. Moving the light with the player keeps it sharp instead.
 */
export function focusShadow(sun: THREE.DirectionalLight, focus: THREE.Vector3): void {
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();
  sun.position.copy(focus).add(SUN_OFFSET);
}

/**
 * Soft greyscale blotches, generated rather than downloaded.
 *
 * A single flat colour across 400x400 units reads as a void: with no texture
 * gradient there is nothing to judge distance or speed against, so the ground
 * looks like a backdrop rather than a surface you are moving over. A few
 * octaves of smooth noise is enough to fix that and costs one 256px canvas.
 */
function createGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // White base, darkened only slightly. A mid-grey base would halve the
  // material colour it multiplies, turning the grass into wet slate.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Blobs at three scales, drawn with wrap-around copies so the tile is
  // seamless — a visible grid on a 400-unit plane would be worse than flat.
  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (const [count, radius, alpha] of [
    [30, 46, 0.03],
    [90, 20, 0.028],
    [200, 8, 0.026],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
          g.addColorStop(0, `rgba(0,0,0,${alpha})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60, 60);
  texture.anisotropy = 16;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGround(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(400, 400);
  const texture = createGroundTexture();
  const mat = new THREE.MeshStandardMaterial({
    // Nudged brighter to offset the texture, which only ever darkens.
    color: 0x587a44,
    roughness: 1,
    map: texture,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
