import * as THREE from 'three';
import { buildShirtGeometry, createShirtMesh, type ShirtCut } from './garment';

/**
 * How one player looks: their skin, their shirt, and what is printed on it.
 *
 * All of it is decoration and all of it is optional — a player who changes
 * nothing gets the model as it was authored. Everything here except the
 * uploaded image travels with every position update, so it stays small and
 * mostly stringly: a few colours and numbers the server can check one at a
 * time without knowing anything about rendering. The image is far too big for
 * that and goes its own way; see net/multiplayer.
 */
export interface Appearance {
  /** Skin tint, multiplied over the body texture. `#rrggbb`. */
  body: string;
  /** Shirt colour as `#rrggbb`, or '' for no shirt at all. */
  shirt: string;
  /** Where the hem falls, in the model's bind-pose Y. Higher is shorter. */
  hem: number;
  /** How far the sleeve reaches along the arm, as bind-pose |x|. */
  sleeve: number;
  /** What is printed across the chest. Empty for a plain shirt. */
  print: string;
  /** Colour the print is drawn in. Ignored by emoji, which bring their own. */
  printColour: string;
  /** Print size, as a multiple of the default box. */
  printScale: number;
  /** An uploaded image as a data URL, or ''. Takes the place of the text. */
  printImage: string;
}

/** Longest print accepted. Past this it stops fitting on a chest. */
export const PRINT_MAX_LENGTH = 12;

/*
 * The shirt's shape, in the model's own bind-pose coordinates.
 *
 * These are not guesses. The body is a single skinned mesh in a T-pose spanning
 * y -0.979 to 0.979, and slicing it by height gives the landmarks directly: the
 * waist is narrowest at y 0.30 (half-width 0.145), the shoulders are widest at
 * y 0.50-0.65 (0.243), and the half-width collapses to 0.113 between y 0.65 and
 * 0.70, which is the neck. Vertices beyond |x| 0.45 all lie between y 0.503 and
 * 0.658, so those are the outstretched arms.
 */
/**
 * Neck hole, as a flat cut the neck rises through.
 *
 * Fussier than it looks. The shoulders slope down and away from the neck, so a
 * horizontal plane crosses them at whatever height it is set to — too low and
 * it takes the collarbone and the tops of the shoulders with it, which reads as
 * an off-shoulder top rather than a t-shirt. This sits above the shoulder line
 * (widest at y 0.50-0.65) and below the point where the half-width has
 * collapsed to the neck's own 0.113, so it clears the shoulders and still
 * leaves a hole the neck fits through.
 */
export const COLLAR_Y = 0.725;
/** Hem range offered, from covering the hips to cropped at the ribs. */
export const HEM_MIN = 0.02;
export const HEM_MAX = 0.34;
/** Sleeve range offered, from a vest to most of the way to the elbow. */
export const SLEEVE_MIN = 0.26;
export const SLEEVE_MAX = 0.72;
export const PRINT_SCALE_MIN = 0.5;
export const PRINT_SCALE_MAX = 1.8;

export const DEFAULT_APPEARANCE: Appearance = {
  body: '#cccccc',
  shirt: '',
  hem: 0.16,
  sleeve: 0.46,
  print: '',
  printColour: '#ffffff',
  printScale: 1,
  printImage: '',
};

export type ApplyAppearance = (appearance: Appearance) => void;

/** Centre and half-extent of the chest print at scale 1, same coordinates. */
const PRINT_CENTRE: [number, number] = [0.0, 0.40];
const PRINT_HALF: [number, number] = [0.155, 0.125];

export function clampAppearance(a: Appearance): Appearance {
  const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    ...a,
    hem: clamp(a.hem, HEM_MIN, HEM_MAX, DEFAULT_APPEARANCE.hem),
    sleeve: clamp(a.sleeve, SLEEVE_MIN, SLEEVE_MAX, DEFAULT_APPEARANCE.sleeve),
    printScale: clamp(a.printScale, PRINT_SCALE_MIN, PRINT_SCALE_MAX, 1),
    print: (a.print ?? '').slice(0, PRINT_MAX_LENGTH),
  };
}

/**
 * The print, spliced into the garment's material.
 *
 * `transformed` holds the untouched vertex position immediately after
 * <begin_vertex> and before <skinning_vertex>, which is the one point in the
 * pipeline where the bind pose is available — the same coordinates the shirt
 * was cut in, so the print can be placed in them too.
 *
 * Projected flat from the front rather than looked up through the model's UVs,
 * because the body arrives as one densely packed 512px atlas with no marked-out
 * chest island; finding one would mean baking a mask per asset, and a planar
 * projection needs nothing but the coordinates already here. It fades out as
 * the surface turns away so it does not smear down the ribs.
 */
const PRINT_VERTEX_PARS = 'varying vec3 vBindPos;';
const PRINT_FRAGMENT_PARS = /* glsl */ `
  varying vec3 vBindPos;
  uniform sampler2D uPrintMap;
  uniform float uPrintOn;
  uniform vec2 uPrintHalf;
`;
const PRINT_FRAGMENT_BODY = /* glsl */ `
  if ( uPrintOn > 0.5 ) {
    vec2 printUv = ( vBindPos.xy - vec2( ${PRINT_CENTRE[0].toFixed(3)}, ${PRINT_CENTRE[1].toFixed(3)} ) )
      / uPrintHalf * 0.5 + 0.5;
    float facing = smoothstep( 0.03, 0.10, vBindPos.z );
    float inside = step( 0.0, printUv.x ) * step( printUv.x, 1.0 )
                 * step( 0.0, printUv.y ) * step( printUv.y, 1.0 );
    vec4 ink = texture2D( uPrintMap, clamp( printUv, 0.0, 1.0 ) );
    // The canvas is sRGB and this is a hand-rolled sampler, so none of three's
    // automatic conversion reaches it.
    ink.rgb = pow( ink.rgb, vec3( 2.2 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, ink.rgb, ink.a * inside * facing );
  }
`;

/**
 * Dress one character, without dressing every other copy of it.
 *
 * The rig is cloned from a single shared source and a clone shares its
 * materials by reference, so writing to them directly would repaint everyone in
 * the world at once. Private copies are taken here, along with a note of the
 * colour each started as, so a tint is a multiply against the original rather
 * than something that accumulates every time the picker moves.
 *
 * Only the largest mesh is treated as the body. The rig is body, hair and eyes;
 * tinting the eyes as well turns a person into a mannequin.
 */
export function createAppearance(root: THREE.Object3D): ApplyAppearance {
  let biggest: THREE.SkinnedMesh | null = null;
  let biggestCount = -1;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const count = mesh.geometry.attributes.position?.count ?? 0;
    if (count > biggestCount) {
      biggestCount = count;
      biggest = mesh;
    }
  });
  if (!biggest) return () => undefined;
  const body = biggest as THREE.SkinnedMesh;

  /* ---- skin ---------------------------------------------------------- */

  const copy = (m: THREE.Material): THREE.MeshStandardMaterial =>
    (m as THREE.MeshStandardMaterial).clone();
  const skinMaterials = Array.isArray(body.material)
    ? body.material.map(copy)
    : [copy(body.material)];
  body.material = Array.isArray(body.material) ? skinMaterials : skinMaterials[0];
  const skinTargets = skinMaterials.map((material) => ({
    material,
    base: material.color.clone(),
  }));

  /* ---- shirt --------------------------------------------------------- */

  const printCanvas = document.createElement('canvas');
  const printTexture = new THREE.CanvasTexture(printCanvas);
  printTexture.colorSpace = THREE.SRGBColorSpace;
  printTexture.anisotropy = 4;

  const printUniforms = {
    uPrintMap: { value: printTexture },
    uPrintOn: { value: 0 },
    uPrintHalf: { value: new THREE.Vector2(PRINT_HALF[0], PRINT_HALF[1]) },
  };

  const shirtMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    // The garment is a surface with no thickness, so the hem, cuffs and neck
    // hole are open. Without this you can see straight through them into an
    // unlit interior whenever the character leans or the camera drops low.
    side: THREE.DoubleSide,
  });
  shirtMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, printUniforms);

    const vertexAnchor = '#include <begin_vertex>';
    const fragmentAnchor = '#include <map_fragment>';
    // Loudly, at startup, rather than as a print that silently stopped
    // appearing after a three.js upgrade moved a chunk. Both of these went
    // missing once already and the only symptom was a plain shirt.
    if (!shader.vertexShader.includes(vertexAnchor)) {
      throw new Error('appearance: three.js vertex shader has no begin_vertex anchor');
    }
    if (!shader.fragmentShader.includes(fragmentAnchor)) {
      throw new Error('appearance: three.js fragment shader has no map_fragment anchor');
    }

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${PRINT_VERTEX_PARS}\nvoid main() {`)
      .replace(vertexAnchor, `${vertexAnchor}\n\tvBindPos = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${PRINT_FRAGMENT_PARS}\nvoid main() {`)
      .replace(fragmentAnchor, `${fragmentAnchor}\n${PRINT_FRAGMENT_BODY}`);

    // Kept for inspection from the console. Reading the compiled program back
    // out of WebGL gives you the source three actually built, which is not the
    // one written here and is no help in working out which of the two is wrong.
    shirtMaterial.userData.shader = shader;
  };

  let shirtMesh: THREE.SkinnedMesh | null = null;
  /** The cut currently built, so a colour change does not rebuild geometry. */
  let builtCut: ShirtCut | null = null;

  const rebuildShirt = (cut: ShirtCut): void => {
    const geometry = buildShirtGeometry(body, cut);
    if (shirtMesh) {
      shirtMesh.geometry.dispose();
      shirtMesh.geometry = geometry;
    } else {
      shirtMesh = createShirtMesh(body, geometry, shirtMaterial);
    }
    builtCut = cut;
  };

  /* ---- print --------------------------------------------------------- */

  /** Kept so a late-arriving image can still be drawn once it decodes. */
  let wantedImage = '';
  const loader = new Image();
  loader.onload = () => {
    if (loader.src !== wantedImage && !loader.src.endsWith(wantedImage)) return;
    drawImagePrint(printCanvas, loader);
    printUniforms.uPrintOn.value = 1;
    printTexture.needsUpdate = true;
  };
  loader.onerror = () => {
    console.warn('[appearance] print image could not be decoded');
  };

  let applied: Appearance | null = null;

  return (raw: Appearance) => {
    const next = clampAppearance(raw);
    if (applied && sameAppearance(applied, next)) return;
    const previous = applied;
    applied = { ...next };

    // Skin. Multiplied rather than replaced, so the texture's detail survives.
    if (!previous || previous.body !== next.body) {
      const tint = new THREE.Color(next.body);
      for (const { material, base } of skinTargets) material.color.copy(base).multiply(tint);
    }

    // Shirt: presence, then shape, then colour.
    if (next.shirt === '') {
      if (shirtMesh) shirtMesh.visible = false;
    } else {
      const cut: ShirtCut = { hem: next.hem, collar: COLLAR_Y, sleeve: next.sleeve };
      if (!builtCut || builtCut.hem !== cut.hem || builtCut.sleeve !== cut.sleeve) {
        rebuildShirt(cut);
      }
      if (shirtMesh) shirtMesh.visible = true;
      shirtMaterial.color.set(next.shirt);
    }

    // Print.
    const printChanged =
      !previous ||
      previous.print !== next.print ||
      previous.printColour !== next.printColour ||
      previous.printImage !== next.printImage;
    if (printChanged) {
      wantedImage = next.printImage;
      if (next.printImage) {
        // Drawn by the load handler; an image already in the cache still fires
        // it, so there is no separate synchronous path to keep in step.
        loader.src = next.printImage;
        printUniforms.uPrintOn.value = 0;
      } else {
        const drawn = drawTextPrint(printCanvas, next.print, next.printColour);
        printUniforms.uPrintOn.value = drawn ? 1 : 0;
        printTexture.needsUpdate = true;
      }
    }
    printUniforms.uPrintHalf.value.set(
      PRINT_HALF[0] * next.printScale,
      PRINT_HALF[1] * next.printScale,
    );
  };
}

function sameAppearance(a: Appearance, b: Appearance): boolean {
  return (
    a.body === b.body &&
    a.shirt === b.shirt &&
    a.hem === b.hem &&
    a.sleeve === b.sleeve &&
    a.print === b.print &&
    a.printColour === b.printColour &&
    a.printScale === b.printScale &&
    a.printImage === b.printImage
  );
}

/** Aspect of the print canvas, matching PRINT_HALF so glyphs are not stretched. */
const PRINT_CANVAS_W = 512;
const PRINT_CANVAS_H = Math.round((PRINT_CANVAS_W * PRINT_HALF[1]) / PRINT_HALF[0]);

function preparePrintCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  canvas.width = PRINT_CANVAS_W;
  canvas.height = PRINT_CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

/**
 * Draw the print text, shrinking the type until it fits.
 *
 * @returns whether anything was drawn.
 */
function drawTextPrint(canvas: HTMLCanvasElement, text: string, colour: string): boolean {
  const ctx = preparePrintCanvas(canvas);
  if (!ctx) return false;

  const trimmed = text.trim().slice(0, PRINT_MAX_LENGTH);
  if (!trimmed) return false;

  // A four-letter word and a single emoji want very different sizes, so the
  // type is fitted to the box rather than chosen in advance.
  const maxWidth = canvas.width * 0.9;
  let size = canvas.height * 0.8;
  const font = (px: number): string =>
    `900 ${Math.round(px)}px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font(size);
  while (size > 12 && ctx.measureText(trimmed).width > maxWidth) {
    size *= 0.92;
    ctx.font = font(size);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = canvas.width / 2;
  const y = canvas.height / 2;

  // A dark rim so light prints stay legible on a light shirt and vice versa.
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineJoin = 'round';
  ctx.strokeText(trimmed, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(trimmed, x, y);
  return true;
}

/** Draw an uploaded image, fitted inside the print box without distortion. */
function drawImagePrint(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const ctx = preparePrintCanvas(canvas);
  if (!ctx) return;
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
