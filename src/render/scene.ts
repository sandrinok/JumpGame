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
 * How far either side of the focus point the shadow frustum reaches, measured
 * along the sun direction rather than vertically.
 *
 * This is a precision setting, not a performance one — worth saying plainly,
 * because it looks like the latter. Tightening the old 1..250 range to this was
 * measured against the 76-placement dev level at five vantage points from the
 * ground to 180m, and the shadow pass drew the same number of calls at every
 * one of them: the 44-unit ortho extent already culls everything the depth
 * range would have, so there was nothing left for a shallower slab to remove.
 *
 * What it does buy is half the depth range over the same buffer, which showed
 * up as a few hundred pixels near the horizon gaining a shadow they had been
 * losing to precision. Nothing lost a shadow anywhere. If sun.shadow.bias is
 * ever retuned, note that it is expressed in NDC depth, so halving the range
 * halved what that constant means in world units.
 *
 * AHEAD is the more delicate of the two, because a caster directly between the
 * player and the sun shadows the player however far away it is; too small and
 * standing under a high platform stops feeling like standing under anything.
 * 60 units along the sun covers about 34 units of height above the player.
 * BEHIND only has to reach the ground the player stands on.
 */
const SHADOW_DEPTH_AHEAD = 60;
const SHADOW_DEPTH_BEHIND = 60;

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
  /** Unit vector towards the sun. The light shafts have to agree with the sky. */
  sunDirection: THREE.Vector3;
  /** Advance the cloud drift. Call once per rendered frame. */
  updateSky(dt: number): void;
}

export function createScene(
  renderer: THREE.WebGLRenderer,
  quality: QualitySettings,
): SceneSetup {
  const scene = new THREE.Scene();
  // The Scene sits at the origin and never moves, but it does not know that: on
  // every frame it recomposes its own (identity) matrix, which sets
  // matrixWorldNeedsUpdate, which makes updateMatrixWorld descend through the
  // entire graph with force set — recomputing every world matrix in the level
  // whatever the nodes themselves say. Holding it still is what lets the static
  // placements in world/level.ts opt out; on its own it changes nothing.
  scene.matrixAutoUpdate = false;

  const sky = new Sky();
  sky.scale.setScalar(SKY_RADIUS);
  const u = sky.material.uniforms;
  // Humid air over a canopy, not a clear spring morning. High turbidity is what
  // sells "jungle" before a single leaf is drawn: it loads the atmosphere with
  // moisture, drops the sky's saturation, and throws a bright haze around the
  // sun that reads as heat. The strong forward-scattering mie term is the same
  // effect seen along the horizon in any nature-documentary rainforest shot.
  // Pushed further than "hazy": rayleigh is what produces saturated blue, and
  // any real blue sky in frame instantly reads as open ground. Almost all of it
  // is traded for mie scattering, which gives a pale, heat-loaded white-green
  // sky that the fog can blend into rather than fight.
  // Haze is a *mie* effect, not an absence of rayleigh. Cutting rayleigh to
  // 0.55 did remove the blue, but it removed the sky's brightness with it and
  // the result read as night. Rayleigh stays up to keep the sky luminous;
  // heavy mie and turbidity are what turn that luminance pale and humid.
  u.turbidity.value = 8.5;
  u.rayleigh.value = 2.1;
  u.mieCoefficient.value = 0.035;
  u.mieDirectionalG.value = 0.9;
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
  /*
   * Cut hard, because this is the main reason the scene read as milky.
   *
   * The environment map is the sky rendered into every direction at once, and
   * this sky is deliberately a bright hazy white-green. At 0.42 that arrives on
   * every surface from every angle, which means nothing in the frame can have a
   * dark side — not a leaf, not the underside of a slab, not the inside of the
   * ruin. Ambient from all directions is by definition the absence of shading.
   *
   * A canopy interior is the opposite: very little light gets in, and what does
   * arrives from one direction as shafts. So ambient goes down and the sun goes
   * up, which is what buys back contrast.
   */
  scene.environmentIntensity = 0.26;
  pmrem.dispose();

  // Re-parent out of the throwaway env scene into the real one.
  scene.add(sky);

  /*
   * Exponential fog, not linear, and green.
   *
   * Linear fog with a 140m near plane means everything inside 140m is
   * perfectly clear — which is the whole playable volume, so the atmosphere
   * never touched anything the player was actually looking at. Exp2 starts
   * immediately and compounds, so a slab 30m up the tower is already sitting in
   * air. That separation between near and far geometry is most of what makes a
   * jungle read as deep rather than as a backdrop.
   *
   * The tint is deliberately not the sky's blue. Light reaching the middle of a
   * canopy has bounced off leaves on the way in, so the haze between you and
   * anything else is green. Getting this colour wrong is what makes a forest
   * look like a field with trees in it.
   */
  // Density backed off once real foliage went in. At 0.0165 the haze was doing
  // the job the trees now do — closing the distance — and it was doing it by
  // draining the colour out of everything inside 40m, which is the whole
  // playable volume. Depth should come from foliage occluding foliage; fog is
  // there to separate the layers, not to be the layers.
  scene.fog = new THREE.FogExp2(0x66804f, 0.0095);

  /*
   * Two bounce terms rather than one.
   *
   * A hemisphere light alone gives sky-above / dirt-below, which is right for
   * an open field and wrong under a canopy: the dominant indirect light in a
   * rainforest is green, arrives from the sides and above, and is much stronger
   * than the ground bounce. The hemisphere carries filtered daylight, and the
   * ground colour is pushed green as well because what is below you here is
   * more leaf litter and undergrowth than soil.
   */
  const hemi = new THREE.HemisphereLight(0x8fae74, 0x0e1309, 0.22);
  scene.add(hemi);

  // Warm shaft light punching through the canopy, against all that green.
  //
  // Dimmer than an open sky deliberately. Under a canopy most of the sun is
  // stopped overhead, and the light that gets through arrives as scattered
  // shafts. Running it at open-field intensity is what kept the concrete
  // clipping to white however dark its albedo was set.
  const sun = new THREE.DirectionalLight(0xffdca0, 3.1);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  // VSM's softness comes from blurring the map, and the blur is measured in
  // texels — so a radius tuned at 2048 is four times as wide, in world units,
  // at 512. Held proportional to the map so the penumbra stays the same size on
  // the ground whatever the tier. Ignored entirely under PCF.
  sun.shadow.radius = quality.softShadows ? (4 * quality.shadowMapSize) / 2048 : 1;
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  // Distances from the light, which sits SUN_DISTANCE from the focus point, so
  // the slab lands centred on the player rather than starting at the sun.
  cam.near = SUN_DISTANCE - SHADOW_DEPTH_AHEAD;
  cam.far = SUN_DISTANCE + SHADOW_DEPTH_BEHIND;
  cam.updateProjectionMatrix();
  // Enough bias to kill acne on the big flat ground, small enough that the
  // character's contact shadow stays attached to its feet — that shadow is the
  // cue you judge a landing by.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // One draw call, but a 1500-unit transparent quad across the sky is a lot of
  // blended pixels for something you glance at — which is exactly the kind of
  // thing the low tier exists to not draw.
  const clouds = quality.clouds ? createCloudDeck(quality.anisotropy) : null;
  if (clouds) scene.add(clouds);

  return {
    scene,
    sun,
    sunDirection: SUN_DIRECTION.clone(),
    updateSky(dt) {
      if (!clouds) return;
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
function createCloudDeck(anisotropy: number): THREE.Mesh {
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
  texture.anisotropy = Math.min(4, anisotropy);

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
function createGroundTexture(anisotropy: number): THREE.CanvasTexture {
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
  // The ground is seen at a grazing angle almost all the time, which is the one
  // case anisotropic filtering exists for — so it is the last texture to give
  // it up, but it does give it up.
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Displace the ground into a riverbed.
 *
 * A single flat plane is the one automatic failure that survived from the
 * baseline: with no variation there is nothing to judge distance or depth
 * against, and a perfectly level floodwater surface sitting on a perfectly
 * level ground plane reads as two sheets of paper.
 *
 * Displacement is kept *below* the waterline everywhere within the tower's
 * radius. A hummock rising through the water inside the play area would be a
 * dry island in the middle of the kill zone — somewhere that looks standable
 * and instantly ends the run. Outside that radius the ground is free to rise
 * into banks, which is what gives the flooded street an edge.
 */
function displaceGround(geo: THREE.BufferGeometry, waterY: number, safeRadius: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (
      hash(ix, iy) * (1 - u) * (1 - v) +
      hash(ix + 1, iy) * u * (1 - v) +
      hash(ix, iy + 1) * (1 - u) * v +
      hash(ix + 1, iy + 1) * u * v
    );
  };

  for (let i = 0; i < pos.count; i++) {
    // The plane is built in XY and rotated later, so its local y is world z.
    const x = pos.getX(i);
    const z = pos.getY(i);
    const r = Math.hypot(x, z);

    let h = noise(x * 0.018, z * 0.018) * 5.2 + noise(x * 0.06, z * 0.06) * 1.4;
    h -= 3.2;

    // Rise towards the far banks, and stay drowned near the tower.
    const bank = Math.max(0, (r - safeRadius) / 120);
    h += bank * bank * 9;

    const ceiling = r < safeRadius ? waterY - 1.1 : waterY + 4;
    pos.setZ(i, Math.min(h, ceiling));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * @param waterY where the flood sits, which is what the terrain is shaped
 *   around. Pass null for a map with no flood: the hand-built maps start on
 *   open ground and their lowest footholds are a metre up, so a landscape
 *   carved to hold a lake puts a dry basin under the first jump.
 */
export function createGround(
  scene: THREE.Scene,
  waterY: number | null = 1.05,
  anisotropy = 16,
): THREE.Mesh {
  // Enough segments to carry the displacement without being a terrain system:
  // 96x96 is 9k verts, drawn once, and never touched again.
  const geo = new THREE.PlaneGeometry(400, 400, 96, 96);
  if (waterY !== null) displaceGround(geo, waterY, 46);
  const texture = createGroundTexture(anisotropy);
  const mat = new THREE.MeshStandardMaterial({
    // Forest floor, not lawn. The old value was a bright meadow green, which
    // read as an open field the moment it filled the lower half of the frame.
    // Under a closed canopy almost no direct light reaches the ground, so it is
    // dark, desaturated and brown-shifted by leaf litter — and a dark floor is
    // also what lets the mossy slab tops read as the brightest thing low in the
    // scene, which is where the player needs their attention.
    color: waterY === null ? 0x4a4f45 : 0x2f3d24,
    roughness: 1,
    map: texture,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
