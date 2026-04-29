import { useRef } from 'react';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarCheckboxItem,
} from './components/menubar';
import { useEditorActions } from './actions';
import { useEditorUi } from './useEditorUi';
import { uiStore } from './uiStore';
import type { DebugMode } from '../../physics/debugView';

const COLLIDER_LABELS: Array<[DebugMode, string]> = [
  ['off', 'Off'],
  ['wire', 'Wireframe'],
  ['solid', 'Solid'],
  ['both', 'Both'],
];

export function Topbar(): JSX.Element {
  const a = useEditorActions();
  const ui = useEditorUi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerImport = (): void => fileInputRef.current?.click();
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.currentTarget.files;
    if (!files) return;
    await a.importGlbs(Array.from(files));
    e.currentTarget.value = '';
  };

  return (
    <div className="absolute top-3 left-3 flex items-center gap-2">
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={a.newLevel}>New <MenubarShortcut>—</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={a.openLevel}>Open… <MenubarShortcut>Ctrl O</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={a.saveLevel}>Save <MenubarShortcut>Ctrl S</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={a.saveLevelAs}>Save As… <MenubarShortcut>Ctrl ⇧ S</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={triggerImport}>Import GLB…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={a.exitEditor}>Exit Editor <MenubarShortcut>F1</MenubarShortcut></MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={a.undo}>Undo <MenubarShortcut>Ctrl Z</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={a.redo}>Redo <MenubarShortcut>Ctrl ⇧ Z</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={a.duplicateSelected} disabled={!ui.selection}>
              Duplicate <MenubarShortcut>Ctrl D</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={a.deleteSelected} disabled={!ui.selection}>
              Delete <MenubarShortcut>X</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarSub>
              <MenubarSubTrigger>Collision</MenubarSubTrigger>
              <MenubarSubContent>
                {COLLIDER_LABELS.map(([mode, label]) => (
                  <MenubarCheckboxItem
                    key={mode}
                    checked={ui.colliderView === mode}
                    onSelect={(e) => {
                      e.preventDefault();
                      a.setColliderView(mode);
                    }}
                  >
                    {label}
                  </MenubarCheckboxItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSub>
              <MenubarSubTrigger>Camera</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => a.snapView('top')}>
                  Top <MenubarShortcut>Num 7</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => a.snapView('front')}>
                  Front <MenubarShortcut>Num 1</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => a.snapView('right')}>
                  Side (Right) <MenubarShortcut>Num 3</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onSelect={() => a.snapView('bottom')}>Bottom <MenubarShortcut>Ctrl Num 7</MenubarShortcut></MenubarItem>
                <MenubarItem onSelect={() => a.snapView('back')}>Back <MenubarShortcut>Ctrl Num 1</MenubarShortcut></MenubarItem>
                <MenubarItem onSelect={() => a.snapView('left')}>Left <MenubarShortcut>Ctrl Num 3</MenubarShortcut></MenubarItem>
                <MenubarSeparator />
                <MenubarItem onSelect={a.toggleOrtho}>
                  Toggle Orthographic <MenubarShortcut>Num 5</MenubarShortcut>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarCheckboxItem
              checked={ui.paletteVisible}
              onSelect={(e) => {
                e.preventDefault();
                uiStore.set({ paletteVisible: !ui.paletteVisible });
              }}
            >
              Assets panel
            </MenubarCheckboxItem>
            <MenubarCheckboxItem
              checked={!ui.outlinerCollapsed}
              onSelect={(e) => {
                e.preventDefault();
                uiStore.set({ outlinerCollapsed: !ui.outlinerCollapsed });
              }}
            >
              Outliner
            </MenubarCheckboxItem>
            <MenubarCheckboxItem
              checked={!ui.hotkeysCollapsed}
              onSelect={(e) => {
                e.preventDefault();
                uiStore.set({ hotkeysCollapsed: !ui.hotkeysCollapsed });
              }}
            >
              Hotkeys panel
            </MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarCheckboxItem
              checked={ui.snapEnabled}
              onSelect={(e) => {
                e.preventDefault();
                a.setSnap(!ui.snapEnabled);
              }}
            >
              Snap (0.5m / 15°)
              <MenubarShortcut>N</MenubarShortcut>
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled>Version 0.1</MenubarItem>
            <MenubarItem disabled>F1 toggles editor</MenubarItem>
            <MenubarItem disabled>RMB + WASD/QE = fly cam</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        multiple
        className="hidden"
        onChange={onFileChosen}
      />
    </div>
  );
}
