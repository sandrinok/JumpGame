import * as THREE from 'three';

/**
 * Colour a character without colouring every other copy of it.
 *
 * The rig is cloned from one shared source, and a clone shares its materials
 * by reference — so writing a colour straight onto them would repaint every
 * player in the world at once, including whoever is looking. This takes a
 * private copy of the materials up front and remembers what colour they
 * started as, so a change is a multiply against the original rather than an
 * accumulating tint.
 *
 * Only the largest mesh is taken. The rig is split into body, hair and eyes;
 * colouring the eyes as well turns a person into a mannequin.
 */
export type Tinter = (colour: string) => void;

export function createTinter(root: THREE.Object3D): Tinter {
  let biggest: THREE.Mesh | null = null;
  let biggestCount = -1;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const count = mesh.geometry.attributes.position?.count ?? 0;
    if (count > biggestCount) {
      biggestCount = count;
      biggest = mesh;
    }
  });
  if (!biggest) return () => undefined;

  const mesh = biggest as THREE.Mesh;
  const copy = (m: THREE.Material): THREE.MeshStandardMaterial =>
    (m as THREE.MeshStandardMaterial).clone();
  const cloned = Array.isArray(mesh.material) ? mesh.material.map(copy) : [copy(mesh.material)];
  mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];

  const targets = cloned.map((material) => ({ material, base: material.color.clone() }));
  let applied = '';

  return (colour: string) => {
    if (colour === applied) return;
    applied = colour;
    const tint = new THREE.Color(colour);
    // Multiplied rather than replaced, so the texture's own detail survives.
    for (const { material, base } of targets) material.color.copy(base).multiply(tint);
  };
}
