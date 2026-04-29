import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LevelHandle, RenderedPlacement } from '../world/level';
import type { Placement, Vec3 } from '../world/types';
import { loadLevelFromDisk, saveLevel, saveLevelAs } from '../persistence/levelFile';
import type { AssetRegistry } from '../world/registry';
import { History } from './history';
import { EditorCameraController } from './cameraController';
import type { Input } from '../core/input';
import type { ColliderShape, ColliderParams } from '../world/types';
import type { PhysicsDebugView } from '../physics/debugView';
import { uiStore } from './ui/uiStore';
import type { EditorActions } from './ui/actions';

export type EditorMode = 'play' | 'edit';

let uidCounter = 0;
function nextUid(): string {
  uidCounter++;
  return `e${Date.now().toString(36)}_${uidCounter}`;
}

const TRANSLATE_SNAP = 0.5;
const ROTATE_SNAP_DEG = 15;
const SCALE_SNAP = 0.1;

export class Editor {
  mode: EditorMode = 'play';
  editorCamera: THREE.PerspectiveCamera;
  private flyCam: EditorCameraController;
  private gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: RenderedPlacement | null = null;
  private gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  private history = new History();
  private snapEnabled = true;
  /** snapshot of placement transform when a gizmo drag begins */
  private dragStart: { uid: string; pos: Vec3; rot: Vec3; scale: Vec3 } | null = null;

  physicsDebug: PhysicsDebugView | null = null;
  onModeChange: ((mode: EditorMode) => void) | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private gameCamera: THREE.PerspectiveCamera,
    private levelHandle: LevelHandle,
    private registry: AssetRegistry,
    private input: Input,
  ) {
    this.editorCamera = new THREE.PerspectiveCamera(60, gameCamera.aspect, 0.1, 1000);
    this.editorCamera.position.set(15, 15, 15);
    this.editorCamera.lookAt(0, 0, 0);

    this.flyCam = new EditorCameraController(this.editorCamera, renderer.domElement);
    this.flyCam.syncFromCamera();

    this.gizmo = new TransformControls(this.editorCamera, renderer.domElement);
    this.applySnap();
    this.gizmo.addEventListener('dragging-changed', (e) => {
      if (e.value) this.beginGizmoDrag();
      else this.endGizmoDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    const helperFn = (this.gizmo as unknown as { getHelper?: () => THREE.Object3D }).getHelper;
    this.gizmoHelper = helperFn ? helperFn.call(this.gizmo) : (this.gizmo as unknown as THREE.Object3D);
    scene.add(this.gizmoHelper);
    this.gizmoHelper.visible = false;

    this.refreshAssets();
    this.publishPlacements();

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));

    const dropTarget = renderer.domElement;
    dropTarget.addEventListener('dragover', (e) => {
      if (this.mode !== 'edit') return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    dropTarget.addEventListener('drop', (e) => this.onDrop(e));
  }

  get activeCamera(): THREE.PerspectiveCamera {
    return this.mode === 'edit' ? this.editorCamera : this.gameCamera;
  }

  setMode(mode: EditorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.flyCam.enabled = mode === 'edit';
    uiStore.set({ visible: mode === 'edit' });
    this.onModeChange?.(mode);
    if (mode === 'play') {
      this.deselect();
      this.flyCam.release();
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      if (document.pointerLockElement) document.exitPointerLock();
      this.editorCamera.position.copy(this.gameCamera.position);
      this.editorCamera.quaternion.copy(this.gameCamera.quaternion);
      this.flyCam.syncFromCamera();
    }
  }

  toggle(): void {
    this.setMode(this.mode === 'play' ? 'edit' : 'play');
  }

  update(dt: number): void {
    if (this.mode !== 'edit') return;
    this.flyCam.update(dt, this.input);
    this.physicsDebug?.update();
  }

  onResize(aspect: number): void {
    this.editorCamera.aspect = aspect;
    this.editorCamera.updateProjectionMatrix();
  }

  private applySnap(): void {
    if (this.snapEnabled) {
      this.gizmo.setTranslationSnap(TRANSLATE_SNAP);
      this.gizmo.setRotationSnap(THREE.MathUtils.degToRad(ROTATE_SNAP_DEG));
      this.gizmo.setScaleSnap(SCALE_SNAP);
    } else {
      this.gizmo.setTranslationSnap(null);
      this.gizmo.setRotationSnap(null);
      this.gizmo.setScaleSnap(null);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'F1') {
      this.toggle();
      e.preventDefault();
      return;
    }
    if (this.mode !== 'edit') return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.history.redo();
      else this.history.undo();
      return;
    }
    if (ctrl && e.code === 'KeyY') {
      e.preventDefault();
      this.history.redo();
      return;
    }
    if (ctrl && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if (ctrl && e.code === 'KeyS') {
      e.preventDefault();
      if (e.shiftKey) saveLevelAs(this.levelHandle.level);
      else saveLevel(this.levelHandle.level);
      return;
    }
    if (ctrl && e.code === 'KeyO') {
      e.preventDefault();
      this.openLevel();
      return;
    }

    if (e.code === 'KeyG' || e.code === 'KeyT') this.setGizmoMode('translate');
    else if (e.code === 'KeyR') this.setGizmoMode('rotate');
    else if (e.code === 'KeyS') this.setGizmoMode('scale');
    else if (e.code === 'Delete' || e.code === 'KeyX') this.deleteSelected();
    else if (e.code === 'Escape') this.deselect();
    else if (e.code === 'KeyN') {
      this.setSnap(!this.snapEnabled);
    }
    else if (e.code === 'KeyC') {
      this.physicsDebug?.cycle();
      uiStore.set({ colliderView: this.physicsDebug?.mode ?? 'off' });
    }
    else if (e.code === 'Enter' || e.code === 'KeyB') {
      const id = uiStore.get().paletteCurrent;
      if (id) this.placeAtCursor(id);
    }
  }

  placeAtCursor(assetId: string): void {
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
    this.execAdd(p);
  }

  duplicateSelected(): void {
    if (!this.selected) return;
    const src = this.selected.placement;
    const p: Placement = {
      id: src.id,
      uid: nextUid(),
      pos: [src.pos[0] + 1, src.pos[1], src.pos[2]],
      rot: [...src.rot] as Vec3,
      scale: [...src.scale] as Vec3,
    };
    this.execAdd(p);
  }

  private execAdd(p: Placement): void {
    this.history.exec({
      label: `add ${p.id}`,
      do: () => {
        const r = this.levelHandle.addPlacement(p);
        if (r) this.select(r);
        this.publishPlacements();
      },
      undo: () => {
        if (this.selected?.placement.uid === p.uid) this.deselect();
        this.levelHandle.removePlacement(p.uid);
        this.publishPlacements();
      },
    });
  }

  deleteSelected(): void {
    if (!this.selected) return;
    const p = this.selected.placement;
    this.deselect();
    this.history.exec({
      label: `delete ${p.id}`,
      do: () => {
        this.levelHandle.removePlacement(p.uid);
        this.publishPlacements();
      },
      undo: () => {
        const r = this.levelHandle.addPlacement(p);
        if (r) this.select(r);
        this.publishPlacements();
      },
    });
  }

  private beginGizmoDrag(): void {
    if (!this.selected) return;
    const p = this.selected.placement;
    this.dragStart = {
      uid: p.uid,
      pos: [...p.pos] as Vec3,
      rot: [...p.rot] as Vec3,
      scale: [...p.scale] as Vec3,
    };
  }

  private endGizmoDrag(): void {
    if (!this.dragStart || !this.selected) {
      this.dragStart = null;
      return;
    }
    const p = this.selected.placement;
    const before = this.dragStart;
    const after = {
      pos: [...p.pos] as Vec3,
      rot: [...p.rot] as Vec3,
      scale: [...p.scale] as Vec3,
    };
    this.dragStart = null;

    if (
      vec3Eq(before.pos, after.pos) &&
      vec3Eq(before.rot, after.rot) &&
      vec3Eq(before.scale, after.scale)
    ) {
      return;
    }

    const uid = before.uid;
    const apply = (t: { pos: Vec3; rot: Vec3; scale: Vec3 }): void => {
      const r = this.levelHandle.rendered.get(uid);
      if (!r) return;
      r.placement.pos = [...t.pos] as Vec3;
      r.placement.rot = [...t.rot] as Vec3;
      r.placement.scale = [...t.scale] as Vec3;
      this.levelHandle.updateTransform(uid);
    };

    this.history.record({
      label: 'transform',
      do: () => apply(after),
      undo: () => apply(before),
    });
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.mode !== 'edit') return;
    // left click only — middle/right are camera controls
    if (e.button !== 0) return;
    // ignore selection clicks while right-mouse fly-look is active
    if (document.pointerLockElement === this.renderer.domElement) return;
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
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.uid === undefined) obj = obj.parent;
    if (!obj) return;
    const uid = obj.userData.uid as string;
    const r = this.levelHandle.rendered.get(uid);
    if (r) this.select(r);
  }

  private select(r: RenderedPlacement): void {
    this.selected = r;
    const isLocked = uiStore.get().locked.has(r.placement.uid);
    if (!isLocked) {
      this.gizmo.attach(r.group);
      this.gizmoHelper.visible = true;
      this.gizmo.setMode(this.gizmoMode);
    } else {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
    }
    uiStore.set({
      selection: r,
      selectionAsset: this.registry.get(r.placement.id) ?? null,
    });
  }

  deselect(): void {
    this.selected = null;
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
    uiStore.set({ selection: null, selectionAsset: null });
  }

  /** Update uiStore with the current registry contents. */
  refreshAssets(): void {
    uiStore.set({ assets: this.registry.all() });
  }

  /** Update uiStore with a fresh placements snapshot for the outliner. */
  publishPlacements(): void {
    uiStore.set({ placements: [...this.levelHandle.level.placements] });
  }

  /** Read-only snapshot of action handlers for the React UI. */
  getActions(): EditorActions {
    return {
      selectPaletteId: (id) => uiStore.set({ paletteCurrent: id }),
      placeAtCursor: (id) => this.placeAtCursor(id),
      changeCollider: (shape) => this.changeSelectedCollider(shape),
      changeColliderParams: (params) => this.changeSelectedColliderParams(params),
      newLevel: () => this.newLevel(),
      openLevel: () => void this.openLevel(),
      saveLevel: () => this.saveLevel(),
      saveLevelAs: () => this.saveLevelAs(),
      importGlbs: (files) => this.importGlbFiles(files),
      undo: () => this.undo(),
      redo: () => this.redo(),
      duplicateSelected: () => this.duplicateSelected(),
      deleteSelected: () => this.deleteSelected(),
      setColliderView: (m) => this.setColliderView(m),
      setSnap: (v) => this.setSnap(v),
      exitEditor: () => this.setMode('play'),
      selectByUid: (uid) => this.selectByUid(uid),
      toggleHidden: (uid) => this.toggleHidden(uid),
      toggleLocked: (uid) => this.toggleLocked(uid),
    };
  }

  /** Change the collider transform overrides for the selected placement. null clears all overrides. */
  changeSelectedColliderParams(next: ColliderParams | null): void {
    if (!this.selected) return;
    const uid = this.selected.placement.uid;
    const before = this.selected.placement.colliderParams;
    if (sameParams(before, next ?? undefined)) return;

    const apply = (params: ColliderParams | null): void => {
      const r = this.levelHandle.rendered.get(uid);
      if (!r) return;
      if (params === null) delete r.placement.colliderParams;
      else r.placement.colliderParams = params;
      this.levelHandle.updateTransform(uid);
      if (this.selected?.placement.uid === uid) {
        uiStore.bumpSelection();
      }
    };

    // For continuous edits we do not want a history entry per keystroke.
    // Skip undo recording when only minor numeric changes; for now do record
    // the snapshot as a single command (debounced caller is responsible for
    // coalescing if needed).
    this.history.exec({
      label: 'collider params',
      do: () => apply(next),
      undo: () => apply(before ?? null),
    });
  }

  /** Change the collider for the selected placement (null = use asset default). */
  changeSelectedCollider(shape: ColliderShape | null): void {
    if (!this.selected) return;
    const uid = this.selected.placement.uid;
    const before = this.selected.placement.collider;
    if (before === shape || (before === undefined && shape === null)) return;

    const apply = (next: ColliderShape | null): void => {
      const r = this.levelHandle.rendered.get(uid);
      if (!r) return;
      if (next === null) delete r.placement.collider;
      else r.placement.collider = next;
      this.levelHandle.updateTransform(uid);
      if (this.selected?.placement.uid === uid) {
        uiStore.bumpSelection();
      }
    };

    this.history.exec({
      label: 'collider',
      do: () => apply(shape),
      undo: () => apply(before ?? null),
    });
  }

  private setGizmoMode(m: 'translate' | 'rotate' | 'scale'): void {
    this.gizmoMode = m;
    this.gizmo.setMode(m);
  }

  private async onDrop(e: DragEvent): Promise<void> {
    if (this.mode !== 'edit') return;
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.glb') && !f.name.toLowerCase().endsWith('.gltf')) {
        console.warn('[editor] ignored non-glb file:', f.name);
        continue;
      }
      const buf = await f.arrayBuffer();
      const id = this.makeAssetId(f.name);
      try {
        await this.registry.addGltfFromArrayBuffer(id, buf, 'trimesh');
        this.refreshAssets();
        uiStore.set({ paletteCurrent: id });
        console.info(`[editor] imported ${f.name} as "${id}" (session-only)`);
      } catch (err) {
        console.error('[editor] import failed:', err);
      }
    }
  }

  private makeAssetId(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
    if (!this.registry.get(base)) return base;
    let i = 2;
    while (this.registry.get(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }

  async openLevel(): Promise<void> {
    const level = await loadLevelFromDisk();
    if (!level) return;
    this.deselect();
    this.history.clear();
    this.levelHandle.replace(level);
    this.publishPlacements();
  }

  saveLevel(): void {
    void saveLevel(this.levelHandle.level);
  }

  saveLevelAs(): void {
    void saveLevelAs(this.levelHandle.level);
  }

  /** Wipe the level, keeping spawn/killY but dropping all placements. */
  newLevel(): void {
    this.deselect();
    this.history.clear();
    this.levelHandle.clear();
    this.publishPlacements();
  }

  /** Select a placement by uid (called from outliner). Locked items still select. */
  selectByUid(uid: string): void {
    const r = this.levelHandle.rendered.get(uid);
    if (!r) return;
    this.select(r);
  }

  toggleHidden(uid: string): void {
    const r = this.levelHandle.rendered.get(uid);
    if (!r) return;
    const cur = uiStore.get().hidden;
    const next = new Set(cur);
    if (next.has(uid)) {
      next.delete(uid);
      r.group.visible = true;
    } else {
      next.add(uid);
      r.group.visible = false;
    }
    uiStore.set({ hidden: next });
  }

  toggleLocked(uid: string): void {
    const cur = uiStore.get().locked;
    const next = new Set(cur);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    uiStore.set({ locked: next });
    // if currently selected and now locked, detach gizmo
    if (next.has(uid) && this.selected?.placement.uid === uid) {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
    }
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  setSnap(enabled: boolean): void {
    if (this.snapEnabled === enabled) return;
    this.snapEnabled = enabled;
    this.applySnap();
    uiStore.set({ snapEnabled: enabled });
  }

  setColliderView(mode: import('../physics/debugView').DebugMode): void {
    this.physicsDebug?.setMode(mode);
    uiStore.set({ colliderView: mode });
  }

  async importGlbFiles(files: File[]): Promise<void> {
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.glb') && !f.name.toLowerCase().endsWith('.gltf')) continue;
      const buf = await f.arrayBuffer();
      const id = this.makeAssetId(f.name);
      try {
        await this.registry.addGltfFromArrayBuffer(id, buf, 'trimesh');
        this.refreshAssets();
        uiStore.set({ paletteCurrent: id });
      } catch (err) {
        console.error('[editor] import failed:', err);
      }
    }
  }

  private onGizmoChange(): void {
    if (!this.selected) return;
    const r = this.selected;
    const p = r.placement;
    p.pos = [r.group.position.x, r.group.position.y, r.group.position.z];
    p.rot = [r.group.rotation.x, r.group.rotation.y, r.group.rotation.z];
    p.scale = [r.group.scale.x, r.group.scale.y, r.group.scale.z];
    this.levelHandle.updateTransform(p.uid);
  }
}

function vec3Eq(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function sameParams(a: ColliderParams | undefined, b: ColliderParams | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const k = (v?: Vec3) => (v ? v.join(',') : '_');
  return k(a.offset) === k(b.offset) && k(a.size) === k(b.size) && k(a.rot) === k(b.rot);
}
