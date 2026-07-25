import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Half-size of the sun's shadow frustum, in world units, around the focus point. */
const SHADOW_EXTENT = 22;
const SHADOW_MAP_SIZE = 2048;

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

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(renderer: THREE.WebGLRenderer): SceneSetup {
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
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
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

  return { scene, sun };
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
