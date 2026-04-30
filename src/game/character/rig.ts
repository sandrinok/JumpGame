import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land';

export interface CharacterRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<CharacterState, THREE.AnimationAction>>;
  current: CharacterState;
}

const FADE = 0.18;
const ONE_SHOT: ReadonlySet<CharacterState> = new Set(['jump', 'land']);

export async function loadCharacterRig(
  url: string,
  animationsUrl?: string,
): Promise<CharacterRig> {
  const loader = new GLTFLoader();
  const [gltf, animsGltf] = await Promise.all([
    loader.loadAsync(url),
    animationsUrl ? loader.loadAsync(animationsUrl) : Promise.resolve(null),
  ]);
  const root = gltf.scene;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const byName: Record<string, THREE.AnimationClip> = {};
  const allClips: THREE.AnimationClip[] = [...gltf.animations];
  if (animsGltf) allClips.push(...animsGltf.animations);
  for (const c of allClips) byName[c.name.toLowerCase()] = c;

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
  grounded: boolean;
  speed: number;
  runSpeed: number;
  verticalVelocity: number;
  justJumped: boolean;
  justLanded: boolean;
  landTimer: number;
}

export function pickState(opts: PickStateOpts): CharacterState {
  if (opts.justJumped) return 'jump';
  if (!opts.grounded) {
    return opts.verticalVelocity > 1.5 ? 'jump' : 'fall';
  }
  if (opts.landTimer > 0) return 'land';
  if (opts.speed < 0.3) return 'idle';
  if (opts.speed > opts.runSpeed * 0.7) return 'run';
  return 'walk';
}
