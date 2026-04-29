import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { LevelHandle, RenderedPlacement } from '../world/level';
import type { Placement, Vec3 } from '../world/types';
import { loadLevelFromDisk, saveLevel, saveLevelAs } from '../persistence/levelFile';
import type { AssetRegistry } from '../world/registry';
import { History } from './history';
import { EditorCameraController, type ViewName } from './cameraController';
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

const ORTHO_FRUSTUM = 20;

export class Editor {
  mode: EditorMode = 'play';
  editorCamera: THREE.PerspectiveCamera;
  editorOrthoCamera: THREE.OrthographicCamera;
  private useOrtho = false;
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
  private dragStartParams: { uid: string; params: ColliderParams | undefined } | null = null;
  /** Proxy object the gizmo controls while editing collider params in focus mode. */
  private colliderProxy: THREE.Object3D | null = null;

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

    const aspect = gameCamera.aspect;
    this.editorOrthoCamera = new THREE.OrthographicCamera(
      -ORTHO_FRUSTUM * aspect, ORTHO_FRUSTUM * aspect,
      ORTHO_FRUSTUM, -ORTHO_FRUSTUM,
      -1000, 1000,
    );
    this.editorOrthoCamera.position.copy(this.editorCamera.position);
    this.editorOrthoCamera.quaternion.copy(this.editorCamera.quaternion);

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

  get activeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    if (this.mode !== 'edit') return this.gameCamera;
    return this.useOrtho ? this.editorOrthoCamera : this.editorCamera;
  }

  setOrtho(useOrtho: boolean): void {
    if (this.useOrtho === useOrtho) return;
    this.useOrtho = useOrtho;
    const cam = useOrtho ? this.editorOrthoCamera : this.editorCamera;
    // Sync the inactive cam to keep it in lockstep on next toggle
    if (useOrtho) {
      this.editorOrthoCamera.position.copy(this.editorCamera.position);
      this.editorOrthoCamera.quaternion.copy(this.editorCamera.quaternion);
    } else {
      this.editorCamera.position.copy(this.editorOrthoCamera.position);
      this.editorCamera.quaternion.copy(this.editorOrthoCamera.quaternion);
    }
    this.flyCam.setCamera(cam);
    (this.gizmo as unknown as { camera: THREE.Camera }).camera = cam;
  }

  toggleOrtho(): void {
    this.setOrtho(!this.useOrtho);
  }

  snapView(view: ViewName): void {
    this.flyCam.snapToView(view);
    // sync the other camera too so toggling ortho/persp keeps the view
    const src = this.useOrtho ? this.editorOrthoCamera : this.editorCamera;
    const dst = this.useOrtho ? this.editorCamera : this.editorOrthoCamera;
    dst.position.copy(src.position);
    dst.quaternion.copy(src.quaternion);
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
    // Keep the proxy aligned with current placement+params (e.g. inspector edits)
    const focus = uiStore.get().colliderFocusUid;
    if (focus && this.colliderProxy && !(this.gizmo as unknown as { dragging: boolean }).dragging) {
      this.syncProxyFromPlacement(focus);
    }
  }

  onResize(aspect: number): void {
    this.editorCamera.aspect = aspect;
    this.editorCamera.updateProjectionMatrix();
    this.editorOrthoCamera.left = -ORTHO_FRUSTUM * aspect;
    this.editorOrthoCamera.right = ORTHO_FRUSTUM * aspect;
    this.editorOrthoCamera.updateProjectionMatrix();
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
    else if (e.code === 'Escape') {
      if (uiStore.get().colliderFocusUid) this.exitColliderFocus();
      else this.deselect();
    }
    else if (e.code === 'KeyN') {
      this.setSnap(!this.snapEnabled);
    }
    else if (e.code === 'KeyC') {
      this.physicsDebug?.cycle();
      uiStore.set({ colliderView: this.physicsDebug?.mode ?? 'off' });
    }
    else if (e.code === 'Numpad1') this.snapView(e.ctrlKey ? 'back' : 'front');
    else if (e.code === 'Numpad3') this.snapView(e.ctrlKey ? 'left' : 'right');
    else if (e.code === 'Numpad7') this.snapView(e.ctrlKey ? 'bottom' : 'top');
    else if (e.code === 'Numpad5') this.toggleOrtho();
    else if (e.code === 'Enter' || e.code === 'KeyB') {
      const id = uiStore.get().paletteCurrent;
      if (id) this.placeAtCursor(id);
    }
  }

  placeAtCursor(assetId: string): void {
    const cam = this.activeCamera;
    const target = new THREE.Vector3();
    cam.getWorldDirection(target);
    target.multiplyScalar(8).add(cam.position);
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
    const focus = uiStore.get().colliderFocusUid;
    if (focus) {
      const r = this.levelHandle.rendered.get(focus);
      if (!r) return;
      this.dragStartParams = {
        uid: focus,
        params: r.placement.colliderParams ? cloneParams(r.placement.colliderParams) : undefined,
      };
      return;
    }
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
    if (this.dragStartParams) {
      const start = this.dragStartParams;
      this.dragStartParams = null;
      const r = this.levelHandle.rendered.get(start.uid);
      if (!r) return;
      const after = r.placement.colliderParams ? cloneParams(r.placement.colliderParams) : undefined;
      const before = start.params;
      const apply = (params: ColliderParams | undefined): void => {
        const live = this.levelHandle.rendered.get(start.uid);
        if (!live) return;
        if (params === undefined) delete live.placement.colliderParams;
        else live.placement.colliderParams = cloneParams(params);
        this.levelHandle.updateTransform(start.uid);
        if (uiStore.get().colliderFocusUid === start.uid) this.syncProxyFromPlacement(start.uid);
        uiStore.bumpSelection();
      };
      this.history.record({
        label: 'collider gizmo',
        do: () => apply(after),
        undo: () => apply(before),
      });
      return;
    }
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
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);

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
      changeTransform: (pos, rot, scale) => this.changeSelectedTransform(pos, rot, scale),
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
      snapView: (v) => this.snapView(v),
      toggleOrtho: () => this.toggleOrtho(),
      enterColliderFocus: (uid) => this.enterColliderFocus(uid),
      exitColliderFocus: () => this.exitColliderFocus(),
    };
  }

  /** Apply absolute transform values to the selected placement (any subset). */
  changeSelectedTransform(pos?: Vec3, rot?: Vec3, scale?: Vec3): void {
    if (!this.selected) return;
    const uid = this.selected.placement.uid;
    const before: { pos: Vec3; rot: Vec3; scale: Vec3 } = {
      pos: [...this.selected.placement.pos] as Vec3,
      rot: [...this.selected.placement.rot] as Vec3,
      scale: [...this.selected.placement.scale] as Vec3,
    };
    const after: { pos: Vec3; rot: Vec3; scale: Vec3 } = {
      pos: pos ?? before.pos,
      rot: rot ?? before.rot,
      scale: scale ?? before.scale,
    };
    if (vec3Eq(before.pos, after.pos) && vec3Eq(before.rot, after.rot) && vec3Eq(before.scale, after.scale)) return;

    const apply = (t: { pos: Vec3; rot: Vec3; scale: Vec3 }): void => {
      const r = this.levelHandle.rendered.get(uid);
      if (!r) return;
      r.placement.pos = [...t.pos] as Vec3;
      r.placement.rot = [...t.rot] as Vec3;
      r.placement.scale = [...t.scale] as Vec3;
      this.levelHandle.updateTransform(uid);
      if (this.selected?.placement.uid === uid) {
        // re-attach gizmo to refresh its position
        this.gizmo.attach(r.group);
        uiStore.bumpSelection();
      }
    };

    this.history.exec({
      label: 'transform (numeric)',
      do: () => apply(after),
      undo: () => apply(before),
    });
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

  /** Isolated view of one placement so the user can see/tweak its collider in peace. */
  enterColliderFocus(uid: string): void {
    const r = this.levelHandle.rendered.get(uid);
    if (!r) return;
    // Hide all other placements
    for (const [otherUid, other] of this.levelHandle.rendered) {
      if (otherUid !== uid) other.group.visible = false;
    }
    // Force solid collision view
    this.physicsDebug?.setMode('solid');
    uiStore.set({ colliderView: 'solid', colliderFocusUid: uid });
    // Frame camera on the placement
    const target = new THREE.Vector3(r.placement.pos[0], r.placement.pos[1], r.placement.pos[2]);
    const offset = new THREE.Vector3(6, 4, 6);
    this.editorCamera.position.copy(target).add(offset);
    this.editorCamera.lookAt(target);
    this.flyCam.syncFromCamera();
    this.editorOrthoCamera.position.copy(this.editorCamera.position);
    this.editorOrthoCamera.quaternion.copy(this.editorCamera.quaternion);

    // Build collider proxy that the gizmo will edit instead of the placement
    this.colliderProxy = new THREE.Object3D();
    this.colliderProxy.userData.colliderProxy = true;
    this.syncProxyFromPlacement(uid);
    (this.colliderProxy.parent ?? null) || (this as { editorScene?: THREE.Scene });
    // Add to gizmo's scene (gizmo's scene is the same as gizmoHelper's scene, which we attached at construction)
    this.gizmoHelper.parent?.add(this.colliderProxy);
    this.gizmo.attach(this.colliderProxy);
    this.gizmoHelper.visible = true;
  }

  exitColliderFocus(): void {
    if (!uiStore.get().colliderFocusUid) return;
    // Restore visibility (respect existing hidden set)
    const hidden = uiStore.get().hidden;
    for (const [uid, r] of this.levelHandle.rendered) {
      r.group.visible = !hidden.has(uid);
    }
    uiStore.set({ colliderFocusUid: null });

    // Tear down proxy + restore gizmo target to placement (if still selected & unlocked)
    if (this.colliderProxy) {
      this.gizmo.detach();
      this.colliderProxy.parent?.remove(this.colliderProxy);
      this.colliderProxy = null;
    }
    if (this.selected && !uiStore.get().locked.has(this.selected.placement.uid)) {
      this.gizmo.attach(this.selected.group);
      this.gizmoHelper.visible = true;
    } else {
      this.gizmoHelper.visible = false;
    }
  }

  /** Position the proxy so it represents the current effective collider transform. */
  private syncProxyFromPlacement(uid: string): void {
    if (!this.colliderProxy) return;
    const r = this.levelHandle.rendered.get(uid);
    if (!r) return;
    const asset = this.registry.get(r.placement.id);
    if (!asset) return;

    const p = r.placement;
    const params = p.colliderParams ?? {};

    const bboxSize = new THREE.Vector3();
    const bboxCenter = new THREE.Vector3();
    if (asset.def.kind === 'gltf') {
      asset.bbox.getSize(bboxSize);
      asset.bbox.getCenter(bboxCenter);
    } else {
      bboxSize.set(1, 1, 1);
      bboxCenter.set(0, 0, 0);
    }

    const offset = new THREE.Vector3(
      params.offset?.[0] ?? bboxCenter.x * p.scale[0],
      params.offset?.[1] ?? bboxCenter.y * p.scale[1],
      params.offset?.[2] ?? bboxCenter.z * p.scale[2],
    );
    const size = new THREE.Vector3(
      params.size?.[0] ?? bboxSize.x * p.scale[0],
      params.size?.[1] ?? bboxSize.y * p.scale[1],
      params.size?.[2] ?? bboxSize.z * p.scale[2],
    );
    const localQ = params.rot
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(params.rot[0], params.rot[1], params.rot[2], 'XYZ'))
      : new THREE.Quaternion();

    const placeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2], 'XYZ'));

    // World position = placement.pos + placementRotation * offset
    const worldPos = offset.clone().applyQuaternion(placeQ).add(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
    const worldQuat = placeQ.clone().multiply(localQ);

    this.colliderProxy.position.copy(worldPos);
    this.colliderProxy.quaternion.copy(worldQuat);
    this.colliderProxy.scale.copy(size);
    this.colliderProxy.updateMatrixWorld(true);
  }

  /** Read the proxy and write computed colliderParams onto the placement. */
  private writeProxyToColliderParams(uid: string): void {
    if (!this.colliderProxy) return;
    const r = this.levelHandle.rendered.get(uid);
    if (!r) return;
    const p = r.placement;
    const placeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0], p.rot[1], p.rot[2], 'XYZ'));
    const placeQinv = placeQ.clone().invert();

    // offset (placement-local)
    const worldOffset = this.colliderProxy.position.clone().sub(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
    const localOffset = worldOffset.applyQuaternion(placeQinv);

    // local rotation
    const localQ = placeQinv.clone().multiply(this.colliderProxy.quaternion);
    const e = new THREE.Euler().setFromQuaternion(localQ, 'XYZ');

    // size = proxy scale (already world dimensions)
    const sz = this.colliderProxy.scale;

    p.colliderParams = {
      offset: [localOffset.x, localOffset.y, localOffset.z],
      size: [sz.x, sz.y, sz.z],
      rot: [e.x, e.y, e.z],
    };
    this.levelHandle.updateTransform(uid);
    uiStore.bumpSelection();
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
    const focus = uiStore.get().colliderFocusUid;
    if (focus && this.colliderProxy) {
      this.writeProxyToColliderParams(focus);
      return;
    }
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

function cloneParams(p: ColliderParams): ColliderParams {
  return {
    offset: p.offset ? ([...p.offset] as Vec3) : undefined,
    size: p.size ? ([...p.size] as Vec3) : undefined,
    rot: p.rot ? ([...p.rot] as Vec3) : undefined,
  };
}
