import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterState = 'idle' | 'walk' | 'run' | 'air';

export interface CharacterRig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<CharacterState, THREE.AnimationAction>>;
  current: CharacterState;
}

const FADE = 0.15;

export async function loadCharacterRig(url: string): Promise<CharacterRig> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
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
  for (const c of gltf.animations) byName[c.name.toLowerCase()] = c;

  const pick = (...names: string[]): THREE.AnimationClip | undefined => {
    for (const n of names) if (byName[n]) return byName[n];
    return undefined;
  };

  const idleClip = pick('idle');
  const walkClip = pick('walk', 'walking');
  const runClip = pick('run', 'running');

  const actions: CharacterRig['actions'] = {};
  if (idleClip) actions.idle = mixer.clipAction(idleClip);
  if (walkClip) actions.walk = mixer.clipAction(walkClip);
  if (runClip) actions.run = mixer.clipAction(runClip);
  // reuse idle as airborne pose for now (no dedicated jump clip in Soldier.glb)
  if (idleClip) actions.air = mixer.clipAction(idleClip);

  for (const a of Object.values(actions)) {
    if (!a) continue;
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
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

export function pickState(opts: { grounded: boolean; speed: number; runSpeed: number }): CharacterState {
  if (!opts.grounded) return 'air';
  if (opts.speed < 0.3) return 'idle';
  if (opts.speed > opts.runSpeed * 0.7) return 'run';
  return 'walk';
}
