import * as THREE from 'three';
import {
  createCharacterRig,
  loadCharacterSource,
  setState,
  type CharacterRig,
  type CharacterSource,
} from './character/rig';
import { appearanceOfRemote, type RemoteState } from '../net/multiplayer';
import { createAppearance, type ApplyAppearance } from './character/appearance';

/**
 * Everyone else, drawn in the local scene.
 *
 * Each remote player is the same rig the local one uses, cloned so it has its
 * own skeleton and its own animation mixer, plus a name plate. Their animation
 * state comes over the wire already decided — the sender knows whether it is
 * running or falling far better than we could infer from two positions.
 *
 * Positions arrive about fifteen times a second, which is visibly steppy if
 * applied directly, so each avatar is drawn moving towards the last position
 * received rather than snapped onto it. That trades a frame of latency for
 * motion that reads as a person rather than a slideshow.
 */

/** Height above the character's feet to float the name plate. */
const LABEL_HEIGHT = 2.35;
/** World units of name plate per pixel of its canvas, i.e. its scale. */
const LABEL_SCALE = 0.0045;
/**
 * How far a player must move in one snapshot before it is treated as a
 * teleport rather than movement. Respawns jump the length of the level, and
 * sliding across that looks like a ghost rather than a spawn.
 */
const TELEPORT_DISTANCE = 8;

interface Avatar {
  group: THREE.Group;
  rig: CharacterRig;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
  /** What the name plate currently reads, so it is only redrawn on a change. */
  labelText: string;
  labelColour: string;
  /** Applies this avatar's own colours to its private copy of the materials. */
  dress: ApplyAppearance;
  /** Where the avatar is drawn now, and where the last snapshot put it. */
  current: THREE.Vector3;
  target: THREE.Vector3;
  currentYaw: number;
  targetYaw: number;
}

export interface RemotePlayers {
  /** Apply the latest snapshot. */
  update(others: RemoteState[]): void;
  /** Advance animation and interpolation. Call once per rendered frame. */
  render(dt: number): void;
  /** Remove every avatar, e.g. on disconnect. */
  clear(): void;
}

export async function createRemotePlayers(
  scene: THREE.Scene,
  modelUrl: string,
  animationsUrl: string,
  /** Height of the local character, so remote ones are scaled to match. */
  targetHeight: number,
): Promise<RemotePlayers> {
  const source = await loadCharacterSource(modelUrl, animationsUrl);
  const avatars = new Map<string, Avatar>();

  // Worked out once from the source rather than per avatar: every copy is the
  // same mesh, so the fit is the same too.
  const bounds = new THREE.Box3().setFromObject(source.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0.0001 ? targetHeight / size.y : 1;
  const footOffset = -bounds.min.y * scale;

  const scratch = new THREE.Vector3();

  function build(state: RemoteState): Avatar {
    const rig = createCharacterRig(source as CharacterSource);
    rig.root.scale.setScalar(scale);
    // The model's origin is not at its feet; nudge it so the group's position
    // can be the position of the soles, which is what the server carries.
    rig.root.position.y = footOffset;

    const group = new THREE.Group();
    group.add(rig.root);

    const labelTexture = createLabelTexture(state.name, state.colour);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: false,
        // Unaffected by the scene's fog and tone mapping: a name is interface,
        // not scenery, and it has to stay readable across the map.
        fog: false,
        toneMapped: false,
      }),
    );
    label.position.y = LABEL_HEIGHT;
    label.scale.set(labelTexture.image.width * LABEL_SCALE, labelTexture.image.height * LABEL_SCALE, 1);
    // Drawn over everything, so a player behind a crate is still findable.
    label.renderOrder = 10;
    group.add(label);

    scene.add(group);

    const avatar: Avatar = {
      group,
      rig,
      label,
      labelTexture,
      labelText: state.name,
      labelColour: state.colour,
      dress: () => undefined,
      current: new THREE.Vector3(...state.p),
      target: new THREE.Vector3(...state.p),
      currentYaw: state.y,
      targetYaw: state.y,
    };
    avatar.dress = createAppearance(avatar.group);
    avatar.dress(appearanceOfRemote(state));
    group.position.copy(avatar.current);
    group.rotation.y = state.y;
    return avatar;
  }

  function destroy(avatar: Avatar): void {
    scene.remove(avatar.group);
    avatar.labelTexture.dispose();
    avatar.label.material.dispose();
    // The cloned skeleton owns its own materials, which were cloned to take a
    // colour, but its geometry is shared with the source and every other
    // avatar — disposing that would blank out everyone still on screen.
    avatar.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
    avatar.rig.mixer.stopAllAction();
  }

  return {
    update(others) {
      const seen = new Set<string>();
      for (const state of others) {
        seen.add(state.id);
        let avatar = avatars.get(state.id);
        if (!avatar) {
          avatar = build(state);
          avatars.set(state.id, avatar);
        }

        scratch.set(...state.p);
        if (scratch.distanceTo(avatar.target) > TELEPORT_DISTANCE) {
          avatar.current.copy(scratch);
          avatar.group.position.copy(scratch);
        }
        avatar.target.copy(scratch);
        avatar.targetYaw = state.y;

        if (state.name !== avatar.labelText || state.colour !== avatar.labelColour) {
          avatar.labelTexture.dispose();
          const texture = createLabelTexture(state.name, state.colour);
          avatar.label.material.map = texture;
          avatar.label.material.needsUpdate = true;
          avatar.label.scale.set(texture.image.width * LABEL_SCALE, texture.image.height * LABEL_SCALE, 1);
          avatar.labelTexture = texture;
          avatar.labelText = state.name;
          avatar.labelColour = state.colour;
        }
        // Cheap to call every snapshot: the applier compares against what it
        // last put on and returns immediately when nothing has changed.
        avatar.dress(appearanceOfRemote(state));
        setState(avatar.rig, state.a);
      }

      for (const [id, avatar] of avatars) {
        if (seen.has(id)) continue;
        destroy(avatar);
        avatars.delete(id);
      }
    },

    render(dt) {
      // Chase the last known position at a rate that closes most of the gap
      // within one snapshot interval. Frame-rate independent, so it behaves the
      // same at 60 and 144Hz.
      const t = 1 - Math.exp(-14 * dt);
      for (const avatar of avatars.values()) {
        avatar.current.lerp(avatar.target, t);
        avatar.group.position.copy(avatar.current);
        avatar.currentYaw = lerpAngle(avatar.currentYaw, avatar.targetYaw, t);
        avatar.group.rotation.y = avatar.currentYaw;
        avatar.rig.mixer.update(dt);
      }
    },

    clear() {
      for (const avatar of avatars.values()) destroy(avatar);
      avatars.clear();
    },
  };
}


/** Draw a name onto a canvas, sized to the text. */
function createLabelTexture(name: string, colour: string): THREE.CanvasTexture {
  const font = '600 40px system-ui, sans-serif';
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(name).width) + 32;
  const height = 60;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(8,12,20,0.6)';
  roundedRect(ctx, 0, 0, width, height, 12);
  ctx.fill();

  // The player's colour on the plate as well as on the character, so the link
  // between the two is obvious from across the level.
  ctx.fillStyle = colour;
  ctx.fillText(name, width / 2, height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
