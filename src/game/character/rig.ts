import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type CharacterState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land';

/**
 * The loaded model and its clips, before anyone is wearing it.
 *
 * Separate from a rig because there may be several people in the world and they
 * all use the same mesh and the same animations. Downloading and parsing that
 * once and cloning per player is the difference between one 600KB fetch and one
 * per person.
 */
export interface CharacterSource {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export interface CharacterRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<CharacterState, THREE.AnimationAction>>;
  current: CharacterState;
}

const FADE = 0.18;
const ONE_SHOT: ReadonlySet<CharacterState> = new Set(['jump', 'land']);

/** In-flight or completed loads, keyed by the pair of URLs. */
const sources = new Map<string, Promise<CharacterSource>>();

/**
 * Download the character once, however many times it is asked for.
 *
 * The promise is cached rather than the result, so several players joining at
 * the same moment share a single request instead of racing each other into
 * three copies of the same download.
 */
export function loadCharacterSource(url: string, animationsUrl?: string): Promise<CharacterSource> {
  const key = `${url}|${animationsUrl ?? ''}`;
  const existing = sources.get(key);
  if (existing) return existing;

  // Character assets are meshopt-compressed by scripts/optimize-character.mjs.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const pending = Promise.all([
    loader.loadAsync(url),
    animationsUrl ? loader.loadAsync(animationsUrl) : Promise.resolve(null),
  ]).then(([gltf, animsGltf]) => ({
    scene: gltf.scene,
    clips: [...gltf.animations, ...(animsGltf ? animsGltf.animations : [])],
  }));
  sources.set(key, pending);
  // A failed load must not be cached, or every later attempt gets the same
  // rejection without ever retrying.
  pending.catch(() => sources.delete(key));
  return pending;
}

export async function loadCharacterRig(
  url: string,
  animationsUrl?: string,
): Promise<CharacterRig> {
  return createCharacterRig(await loadCharacterSource(url, animationsUrl));
}

/** Build an independent, separately-animated copy of the character. */
export function createCharacterRig(source: CharacterSource): CharacterRig {
  // A plain Object3D.clone() shares the skeleton, so every copy would be posed
  // by whichever mixer ran last — all of them moving as one. SkeletonUtils
  // rebuilds the bone hierarchy and rebinds the skinned meshes to it.
  const root = cloneSkeleton(source.scene);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const byName: Record<string, THREE.AnimationClip> = {};
  for (const c of source.clips) byName[c.name.toLowerCase()] = c;

  const pick = (...names: string[]): THREE.AnimationClip | undefined => {
    for (const n of names) {
      const c = byName[n.toLowerCase()];
      if (c) return c;
    }
    return undefined;
  };

  const clips: Partial<Record<CharacterState, THREE.AnimationClip>> = {
    idle: pick('idle_loop', 'idle', 'unarmed_idle'),
    walk: pick('walk_loop', 'walking_a', 'walk', 'walking'),
    run: pick('jog_fwd_loop', 'sprint_loop', 'running_a', 'run', 'running'),
    jump: pick('jump_start', 'jump'),
    fall: pick('jump_loop', 'jump_idle', 'falling_idle', 'falling', 'fall'),
    land: pick('jump_land', 'landing', 'land'),
  };

  // Fallbacks: prefer idle as a stable airborne pose over a mismatched clip
  if (!clips.fall) clips.fall = clips.idle;
  if (!clips.jump) clips.jump = clips.idle;
  if (!clips.land) clips.land = clips.idle;

  const actions: CharacterRig['actions'] = {};
  for (const [state, clip] of Object.entries(clips) as [CharacterState, THREE.AnimationClip | undefined][]) {
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (ONE_SHOT.has(state)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    actions[state] = a;
  }

  if (actions.idle) actions.idle.setEffectiveWeight(1);

  return { root, mixer, actions, current: 'idle' };
}

export function setState(rig: CharacterRig, next: CharacterState): void {
  if (rig.current === next) return;
  const from = rig.actions[rig.current];
  const to = rig.actions[next];
  if (from) from.fadeOut(FADE);
  if (to) {
    to.reset();
    to.setEffectiveWeight(1);
    to.fadeIn(FADE);
    to.play();
  }
  rig.current = next;
}

export interface PickStateOpts {
  /**
   * Off the ground long enough to mean it — not merely on the frame the
   * character controller happened to lose contact. See AIR_ANIM_GRACE.
   */
  airborne: boolean;
  speed: number;
  runSpeed: number;
  verticalVelocity: number;
  justJumped: boolean;
  landTimer: number;
}

export function pickState(opts: PickStateOpts): CharacterState {
  if (opts.justJumped) return 'jump';
  if (opts.airborne) {
    return opts.verticalVelocity > 1.5 ? 'jump' : 'fall';
  }
  if (opts.landTimer > 0) return 'land';
  if (opts.speed < 0.3) return 'idle';
  if (opts.speed > opts.runSpeed * 0.7) return 'run';
  return 'walk';
}
