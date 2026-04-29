import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LevelHandle, RenderedPlacement } from '../world/level';
import type { Palette } from './palette';
import type { Placement } from '../world/types';

export type EditorMode = 'play' | 'edit';

let uidCounter = 0;
function nextUid(): string {
  uidCounter++;
  return `e${Date.now().toString(36)}_${uidCounter}`;
}

export class Editor {
  mode: EditorMode = 'play';
  editorCamera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: RenderedPlacement | null = null;
  private gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  palette: Palette | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private gameCamera: THREE.PerspectiveCamera,
    private levelHandle: LevelHandle,
  ) {
    this.editorCamera = new THREE.PerspectiveCamera(60, gameCamera.aspect, 0.1, 1000);
    this.editorCamera.position.set(15, 15, 15);
    this.editorCamera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.editorCamera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.enabled = false;

    this.gizmo = new TransformControls(this.editorCamera, renderer.domElement);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value && this.mode === 'edit';
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    const helperFn = (this.gizmo as unknown as { getHelper?: () => THREE.Object3D }).getHelper;
    this.gizmoHelper = helperFn ? helperFn.call(this.gizmo) : (this.gizmo as unknown as THREE.Object3D);
    scene.add(this.gizmoHelper);
    this.gizmoHelper.visible = false;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  get activeCamera(): THREE.PerspectiveCamera {
    return this.mode === 'edit' ? this.editorCamera : this.gameCamera;
  }

  setMode(mode: EditorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.orbit.enabled = mode === 'edit';
    this.palette?.setVisible(mode === 'edit');
    if (mode === 'play') {
      this.deselect();
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      if (document.pointerLockElement) document.exitPointerLock();
      // position editor cam near player on entry
      this.editorCamera.position.copy(this.gameCamera.position);
      this.orbit.target.copy(this.gameCamera.position).add(new THREE.Vector3(0, 0, -5));
      this.orbit.update();
    }
  }

  toggle(): void {
    this.setMode(this.mode === 'play' ? 'edit' : 'play');
  }

  update(): void {
    if (this.mode === 'edit') this.orbit.update();
  }

  onResize(aspect: number): void {
    this.editorCamera.aspect = aspect;
    this.editorCamera.updateProjectionMatrix();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'F1') {
      this.toggle();
      e.preventDefault();
      return;
    }
    if (this.mode !== 'edit') return;
    if (e.code === 'KeyG' || e.code === 'KeyT') this.setGizmoMode('translate');
    else if (e.code === 'KeyR') this.setGizmoMode('rotate');
    else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) this.setGizmoMode('scale');
    else if (e.code === 'Delete' || e.code === 'KeyX') this.deleteSelected();
    else if (e.code === 'Escape') this.deselect();
    else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
      this.duplicateSelected();
      e.preventDefault();
    }
    else if ((e.code === 'Enter' || e.code === 'KeyB') && this.palette) {
      const id = this.palette.current();
      if (id) this.placeAtCursor(id);
    }
  }

  private placeAtCursor(assetId: string): void {
    const target = new THREE.Vector3();
    this.editorCamera.getWorldDirection(target);
    target.multiplyScalar(8).add(this.editorCamera.position);
    const p: Placement = {
      id: assetId,
      uid: nextUid(),
      pos: [target.x, target.y, target.z],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const r = this.levelHandle.addPlacement(p);
    if (r) this.select(r);
  }

  private duplicateSelected(): void {
    if (!this.selected) return;
    const src = this.selected.placement;
    const p: Placement = {
      id: src.id,
      uid: nextUid(),
      pos: [src.pos[0] + 1, src.pos[1], src.pos[2]],
      rot: [...src.rot] as [number, number, number],
      scale: [...src.scale] as [number, number, number],
    };
    const r = this.levelHandle.addPlacement(p);
    if (r) this.select(r);
  }

  private setGizmoMode(m: 'translate' | 'rotate' | 'scale'): void {
    this.gizmoMode = m;
    this.gizmo.setMode(m);
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.mode !== 'edit') return;
    if (e.button !== 0) return;
    // ignore clicks on gizmo
    if ((this.gizmo as unknown as { dragging: boolean }).dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.editorCamera);

    const groups = [...this.levelHandle.rendered.values()].map((r) => r.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) {
      this.deselect();
      return;
    }
    // walk up to placement group (which has uid)
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.uid === undefined) obj = obj.parent;
    if (!obj) return;
    const uid = obj.userData.uid as string;
    const r = this.levelHandle.rendered.get(uid);
    if (r) this.select(r);
  }

  private select(r: RenderedPlacement): void {
    this.selected = r;
    this.gizmo.attach(r.group);
    this.gizmoHelper.visible =true;
    this.gizmo.setMode(this.gizmoMode);
  }

  deselect(): void {
    this.selected = null;
    this.gizmo.detach();
    this.gizmoHelper.visible =false;
  }

  private deleteSelected(): void {
    if (!this.selected) return;
    const uid = this.selected.placement.uid;
    this.deselect();
    this.levelHandle.removePlacement(uid);
  }

  private onGizmoChange(): void {
    if (!this.selected) return;
    const r = this.selected;
    const p = r.placement;
    p.pos = [r.group.position.x, r.group.position.y, r.group.position.z];
    p.rot = [r.group.rotation.x, r.group.rotation.y, r.group.rotation.z];
    p.scale = [r.group.scale.x, r.group.scale.y, r.group.scale.z];
    // rebuild physics body to match new transform
    this.levelHandle.updateTransform(p.uid);
  }
}
