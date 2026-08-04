import type { ScoreData } from '../persistence/score';
import { appearanceOf, bestOn, saveScore } from '../persistence/score';
import { HUB_URL, type MapInfo } from '../world/maps';
import { createLeaderboard } from './leaderboard';
import type { ScoreEntry } from '../persistence/leaderboard';
import { createCharacterPreview } from './characterPreview';
import { ensureStartScreenStyles } from './startScreenStyles';
import {
  HEM_MAX,
  HEM_MIN,
  PRINT_MAX_LENGTH,
  PRINT_SCALE_MAX,
  PRINT_SCALE_MIN,
  SLEEVE_MAX,
  SLEEVE_MIN,
} from '../game/character/appearance';
import { preparePrintImage, PrintImageError } from '../game/character/printImage';

export interface StartScreen {
  show(): void;
  hide(): void;
  onPlay: () => void;
  onCredits: () => void;
  onSettings: () => void;
  /**
   * Name or appearance changed. The new values are already written into the
   * `score` object this screen was handed and saved, so there is nothing to
   * pass — a signal, not a payload, and one less pair of values that can drift
   * apart from what was persisted.
   */
  onIdentityChange: () => void;
  /** Draw a board the caller already has, e.g. one a submission returned. */
  setScores(scores: ScoreEntry[]): void;
  /**
   * Begin without the player pressing anything.
   *
   * For arrivals through a hub portal: walking into it was already the decision
   * to play, and putting a menu in front of them asks the same question twice.
   */
  startImmediately(): void;
}

/**
 * One-click prints, purely so the field is not an empty box.
 *
 * The point of these is discoverability rather than choice: nobody types an
 * emoji into a text input unless something suggests that emoji are allowed,
 * and once one person turns up wearing a crown the rest work it out.
 */
const PRINT_SUGGESTIONS = ['⚡', '🔥', '💀', '👑', '🍕', '🐍', '★', '99'];

/** Shirt colours worth one click. Anything else is a colour picker away. */
const SHIRT_SWATCHES = [
  '#e5533d',
  '#f2a541',
  '#6cc551',
  '#3fb8af',
  '#4a8fe7',
  '#8b5cf6',
  '#f5f5f5',
  '#1c1c22',
];

export function createStartScreen(
  parent: HTMLElement,
  score: ScoreData,
  map: MapInfo,
): StartScreen {
  ensureStartScreenStyles();

  const root = document.createElement('div');
  root.className = 'jg-scroll';
  root.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, rgba(8,12,20,0.85), rgba(8,12,20,0.95));
    color: #eee; font: 14px system-ui, sans-serif;
    z-index: 100; overflow: auto;
  `;

  /*
   * A masthead over the panels, and the panels under it.
   *
   * The title used to live inside the middle panel, which put the name of the
   * game at the same level as the controls for a t-shirt — it read as that
   * panel's heading rather than as the screen's. It belongs above the whole
   * block, where it names everything under it instead of one third of it.
   *
   * Leaving is in the same row, hard left. A way out is navigation, and
   * navigation goes at the edge of the frame it leaves; buried at the bottom of
   * the centre panel, under the Play button, it read as one more thing to do
   * here rather than as the door.
   */
  const shell = document.createElement('div');
  shell.style.cssText = `
    display: flex; flex-direction: column; gap: 14px;
    padding: 24px; margin: auto;
  `;
  root.appendChild(shell);

  const header = document.createElement('div');
  header.style.cssText = `
    position: relative; display: flex; flex-direction: column;
    align-items: center; text-align: center; min-height: 34px;
    padding: 0 8px 2px;
  `;
  shell.appendChild(header);

  const hubBtn = document.createElement('button');
  hubBtn.className = 'jg-btn jg-quiet';
  hubBtn.textContent = '← Hub';
  hubBtn.title = 'Back to the map selection';
  hubBtn.style.cssText = `
    position: absolute; left: 0; top: 0;
    padding: 6px 14px; font-size: 13px; color: #cfd6e4;
  `;
  hubBtn.addEventListener('click', () => {
    location.href = HUB_URL;
  });
  header.appendChild(hubBtn);

  const title = document.createElement('div');
  title.textContent = 'JumpGame';
  title.style.cssText = `
    font-size: 34px; font-weight: 800; letter-spacing: 1px; line-height: 1.1;
    text-shadow: 0 2px 14px rgba(0,0,0,0.6);
  `;
  header.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = "Get as high as you can. Don't fall.";
  sub.style.cssText = 'opacity: 0.65; font-size: 13px; margin-top: 4px;';
  header.appendChild(sub);

  /*
   * Three panels: what you are wearing, what it looks like, and who is winning.
   *
   * The character earns the middle because it is the thing all the controls on
   * its left are for — and because it is the only panel whose whole point is to
   * be looked at. They wrap and stack on anything too narrow to hold them.
   */
  const layout = document.createElement('div');
  layout.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 16px;
    align-items: stretch; justify-content: center;
  `;
  shell.appendChild(layout);

  /* ================= left: the controls ================= */

  const controls = document.createElement('div');
  controls.className = 'jg-panel';
  controls.style.cssText = 'width: 290px; max-width: calc(100vw - 48px); padding: 20px;';
  layout.appendChild(controls);

  const preview = createCharacterPreview(300, 430);

  /** Persist, tell the world, and update the model, in that order. */
  const changed = (): void => {
    saveScore(score);
    preview.setAppearance(appearanceOf(score));
    api.onIdentityChange();
  };

  const sectionLabel = (text: string): HTMLElement => {
    const el = document.createElement('div');
    el.textContent = text;
    el.className = 'jg-label';
    el.style.marginBottom = '8px';
    return el;
  };

  const divider = (): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'jg-divider';
    return el;
  };

  controls.appendChild(sectionLabel('You'));

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'jg-field';
  nameInput.maxLength = 24;
  nameInput.value = score.name;
  nameInput.placeholder = 'Your name';
  nameInput.style.marginBottom = '10px';
  controls.appendChild(nameInput);

  /**
   * A labelled colour well, of which this screen has three.
   *
   * The hex sits beside the swatch because a colour input is a 40px rectangle
   * with no other way to tell two near-identical greens apart — and because a
   * value you can read is a value you can write down and use again.
   */
  const colourWell = (
    label: string,
    initial: string,
    onPick: (value: string) => void,
  ): { row: HTMLElement; input: HTMLInputElement; sync: (value: string) => void } => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const text = document.createElement('div');
    text.textContent = label;
    text.style.cssText = 'opacity: 0.7; font-size: 13px; flex: 1;';

    const hex = document.createElement('div');
    hex.style.cssText =
      'font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; opacity: 0.4; letter-spacing: 0.02em;';

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'jg-colour';
    input.value = initial;

    const sync = (value: string): void => {
      input.value = value;
      hex.textContent = value.toUpperCase();
    };
    sync(initial);

    input.addEventListener('input', () => {
      hex.textContent = input.value.toUpperCase();
      onPick(input.value);
    });

    row.append(text, hex, input);
    return { row, input, sync };
  };

  /** A slider with its extremes named, since a bare track explains nothing. */
  const slider = (
    label: string,
    lowEnd: string,
    highEnd: string,
    min: number,
    max: number,
    value: number,
    onSlide: (v: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement } => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 10px;';
    const head = document.createElement('div');
    head.textContent = label;
    head.style.cssText = 'font-size: 12px; opacity: 0.75; margin-bottom: 3px;';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'jg-range';
    input.min = String(min);
    input.max = String(max);
    input.step = String((max - min) / 100);
    input.value = String(value);
    input.addEventListener('input', () => onSlide(Number(input.value)));
    const ends = document.createElement('div');
    ends.style.cssText =
      'display: flex; justify-content: space-between; font-size: 10px; opacity: 0.4; margin-top: -2px;';
    const lo = document.createElement('span');
    lo.textContent = lowEnd;
    const hi = document.createElement('span');
    hi.textContent = highEnd;
    ends.append(lo, hi);
    row.append(head, input, ends);
    return { row, input };
  };

  const body = colourWell('Skin', score.colour, (value) => {
    score.colour = value;
    changed();
  });
  controls.appendChild(body.row);
  controls.appendChild(divider());

  /* ---- the shirt ---------------------------------------------------- */

  const shirtHead = document.createElement('div');
  shirtHead.style.cssText =
    'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;';
  const shirtTitle = sectionLabel('Shirt');
  shirtTitle.style.marginBottom = '0';

  // Not a checkbox: "no shirt" is the state the game shipped with and the one
  // every existing save is in, so it has to be one obvious click away.
  const shirtToggle = document.createElement('button');
  shirtToggle.className = 'jg-btn';
  shirtToggle.style.cssText = 'padding: 4px 11px; font-size: 11px;';
  shirtHead.append(shirtTitle, shirtToggle);
  controls.appendChild(shirtHead);

  /** Everything that only makes sense while a shirt is being worn. */
  const shirtBody = document.createElement('div');
  shirtBody.style.transition = 'opacity 0.15s';
  controls.appendChild(shirtBody);

  /** Remembered so turning the shirt off and on again returns the same one. */
  let lastShirtColour = score.shirt || '#4a8fe7';

  const shirtColour = colourWell('Colour', lastShirtColour, (value) => {
    lastShirtColour = value;
    score.shirt = value;
    paintSwatches();
    changed();
  });
  shirtColour.row.style.marginBottom = '8px';
  shirtBody.appendChild(shirtColour.row);

  const swatchRow = document.createElement('div');
  swatchRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;';
  const swatchButtons: Array<{ colour: string; el: HTMLButtonElement }> = [];
  for (const swatch of SHIRT_SWATCHES) {
    const btn = document.createElement('button');
    btn.className = 'jg-swatch';
    btn.title = swatch;
    btn.style.background = swatch;
    btn.addEventListener('click', () => {
      lastShirtColour = swatch;
      score.shirt = swatch;
      shirtColour.sync(swatch);
      paintShirtControls();
      changed();
    });
    swatchRow.appendChild(btn);
    swatchButtons.push({ colour: swatch, el: btn });
  }
  shirtBody.appendChild(swatchRow);

  /** Ring whichever swatch is the colour currently being worn, if any. */
  function paintSwatches(): void {
    const worn = score.shirt.toLowerCase();
    for (const { colour, el } of swatchButtons) {
      el.dataset.on = colour.toLowerCase() === worn ? '1' : '0';
    }
  }

  // The shirt is real geometry cut from the body, so these two are not
  // adjustments to a picture — they move where the garment is actually cut.
  const hem = slider('Length', 'Long', 'Cropped', HEM_MIN, HEM_MAX, score.hem, (v) => {
    score.hem = v;
    changed();
  });
  shirtBody.appendChild(hem.row);

  const sleeve = slider('Sleeves', 'Vest', 'Long', SLEEVE_MIN, SLEEVE_MAX, score.sleeve, (v) => {
    score.sleeve = v;
    changed();
  });
  shirtBody.appendChild(sleeve.row);

  /* ---- the print ---------------------------------------------------- */

  shirtBody.appendChild(divider());
  shirtBody.appendChild(sectionLabel('Print'));

  const printRow = document.createElement('div');
  printRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
  const printInput = document.createElement('input');
  printInput.type = 'text';
  printInput.className = 'jg-field';
  printInput.maxLength = PRINT_MAX_LENGTH;
  printInput.placeholder = 'Text or emoji';
  printInput.value = score.print;
  printInput.style.cssText = 'flex: 1; min-width: 0;';
  printInput.addEventListener('input', () => {
    score.print = printInput.value;
    paintSuggestions();
    changed();
  });
  const printColour = colourWell('', score.printColour, (value) => {
    score.printColour = value;
    changed();
  });
  printColour.input.title = 'Print colour';
  printRow.append(printInput, printColour.row);
  shirtBody.appendChild(printRow);

  const suggestRow = document.createElement('div');
  suggestRow.style.cssText = 'display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 12px;';
  const suggestButtons: Array<{ value: string; el: HTMLButtonElement }> = [];
  for (const suggestion of PRINT_SUGGESTIONS) {
    const btn = document.createElement('button');
    btn.className = 'jg-btn jg-chip';
    btn.textContent = suggestion;
    btn.addEventListener('click', () => {
      // Toggling, so a second click on the one you are wearing takes it off.
      score.print = score.print === suggestion ? '' : suggestion;
      printInput.value = score.print;
      paintSuggestions();
      changed();
    });
    suggestRow.appendChild(btn);
    suggestButtons.push({ value: suggestion, el: btn });
  }
  shirtBody.appendChild(suggestRow);

  /** Mark the suggestion being worn, so a second click reads as "take it off". */
  function paintSuggestions(): void {
    for (const { value, el } of suggestButtons) {
      el.dataset.on = score.print === value ? '1' : '0';
    }
  }

  const printSize = slider(
    'Print size',
    'Small',
    'Large',
    PRINT_SCALE_MIN,
    PRINT_SCALE_MAX,
    score.printScale,
    (v) => {
      score.printScale = v;
      changed();
    },
  );
  shirtBody.appendChild(printSize.row);

  /* ---- an uploaded picture ------------------------------------------ */

  const uploadRow = document.createElement('div');
  uploadRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 4px;';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'jg-btn';
  uploadBtn.textContent = 'Upload a picture';
  uploadBtn.style.cssText = `
    flex: 1; padding: 7px 10px; font-size: 12px; border-style: dashed;
  `;
  uploadBtn.addEventListener('click', () => fileInput.click());

  /** Shows what was uploaded, and doubles as the way to remove it. */
  const thumb = document.createElement('button');
  thumb.className = 'jg-btn';
  thumb.title = 'Remove this picture';
  thumb.style.cssText = `
    width: 34px; height: 34px; flex-shrink: 0; padding: 0;
    background-size: contain; background-position: center;
    background-repeat: no-repeat; background-color: #0f0f14;
  `;
  thumb.addEventListener('click', () => {
    score.printImage = '';
    paintPrintControls();
    changed();
  });
  uploadRow.append(uploadBtn, thumb);
  shirtBody.append(uploadRow, fileInput);

  const uploadNote = document.createElement('div');
  uploadNote.style.cssText = 'font-size: 11px; opacity: 0.45; margin-top: 6px; line-height: 1.45;';
  shirtBody.appendChild(uploadNote);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    // Cleared straight away, or picking the same file twice in a row fires no
    // second change event and the upload silently does nothing.
    fileInput.value = '';
    if (!file) return;
    uploadNote.textContent = 'Shrinking…';
    void preparePrintImage(file)
      .then((dataUrl) => {
        score.printImage = dataUrl;
        paintPrintControls();
        changed();
      })
      .catch((e: unknown) => {
        uploadNote.textContent =
          e instanceof PrintImageError ? e.message : 'That image could not be used.';
        console.warn('[print] upload failed:', e);
      });
  });

  /** Reflect whether a picture is in use across the print controls. */
  function paintPrintControls(): void {
    const hasImage = score.printImage !== '';
    thumb.style.display = hasImage ? 'block' : 'none';
    thumb.style.backgroundImage = hasImage ? `url("${score.printImage}")` : 'none';
    uploadBtn.textContent = hasImage ? 'Replace picture' : 'Upload a picture';
    // The text and the picture occupy the same square of shirt, so saying which
    // one wins beats letting the player wonder why their typing stopped working.
    printInput.disabled = hasImage;
    suggestRow.style.opacity = hasImage ? '0.4' : '1';
    suggestRow.style.pointerEvents = hasImage ? 'none' : 'auto';
    uploadNote.textContent = hasImage
      ? 'The picture is worn instead of the text. Everyone else sees it too.'
      : 'Shrunk to a small square before it is worn, and shared with everyone in the world.';
  }

  /** Reflect whether a shirt is being worn across the whole block. */
  function paintShirtControls(): void {
    const worn = score.shirt !== '';
    shirtToggle.textContent = worn ? 'Take it off' : 'Put one on';
    shirtBody.style.opacity = worn ? '1' : '0.3';
    shirtBody.style.pointerEvents = worn ? 'auto' : 'none';
    paintSwatches();
  }

  shirtToggle.addEventListener('click', () => {
    score.shirt = score.shirt ? '' : lastShirtColour;
    shirtColour.sync(lastShirtColour);
    paintShirtControls();
    changed();
  });

  /* ================= middle: the character ================= */

  const stage = document.createElement('div');
  stage.className = 'jg-panel';
  stage.style.cssText = `
    width: 340px; max-width: calc(100vw - 48px); padding: 20px;
    display: flex; flex-direction: column; align-items: center; text-align: center;
  `;
  layout.appendChild(stage);

  // The map, now that the game's name has moved to the masthead. This panel is
  // about the run you are one click from starting, and which climb that is was
  // previously only stated on the button.
  const mapName = document.createElement('div');
  mapName.textContent = map.title;
  mapName.style.cssText = 'font-size: 17px; font-weight: 700;';
  stage.appendChild(mapName);

  const mapBlurb = document.createElement('div');
  mapBlurb.textContent = map.blurb;
  mapBlurb.style.cssText =
    'opacity: 0.55; font-size: 12px; line-height: 1.45; margin: 4px 0 14px;';
  stage.appendChild(mapBlurb);

  stage.appendChild(preview.element);

  const previewHint = document.createElement('div');
  previewHint.textContent = 'Drag to turn';
  previewHint.style.cssText = 'font-size: 11px; opacity: 0.4; margin-top: 6px;';
  stage.appendChild(previewHint);

  const bestEl = document.createElement('div');
  bestEl.style.cssText = 'opacity: 0.85; margin: 14px 0 12px; font-size: 13px;';
  const renderBest = (): void => {
    // "Your best", not "Best". This is the record on this browser; the board
    // beside it is the one everybody shares, and labelling both the same way
    // was how the local number came to read as the record.
    const best = bestOn(score, map.id);
    bestEl.textContent = best > 0 ? `Your best here: ${best.toFixed(1)} m` : 'No runs here yet.';
  };
  renderBest();
  stage.appendChild(bestEl);

  const playBtn = document.createElement('button');
  playBtn.className = 'jg-btn jg-primary';
  playBtn.textContent = 'Play';
  playBtn.style.cssText = 'padding: 11px 40px; font-size: 16px;';
  stage.appendChild(playBtn);

  const hint = document.createElement('div');
  hint.textContent = 'Click the canvas for mouse-look · Esc to end the run';
  hint.style.cssText = 'margin-top: 14px; font-size: 12px; opacity: 0.5;';
  stage.appendChild(hint);

  // The quiet row: things worth reaching without being what the screen is for.
  const minorRow = document.createElement('div');
  minorRow.style.cssText = 'margin-top: 12px; display: flex; gap: 8px; justify-content: center;';
  stage.appendChild(minorRow);

  const minorButton = (label: string, onClick: () => void): void => {
    const btn = document.createElement('button');
    btn.className = 'jg-btn jg-quiet';
    btn.textContent = label;
    btn.style.cssText = 'padding: 5px 12px; font-size: 12px;';
    btn.addEventListener('click', onClick);
    minorRow.appendChild(btn);
  };

  // Graphics quality used to be reachable only by typing ?quality=low into the
  // address bar, which is no help to the person whose laptop is struggling.
  minorButton('Settings', () => api.onSettings());
  // Most of the 3D assets are CC-BY, which requires the credit to be reachable
  // from the published game — not just sitting in a file in the repo.
  minorButton('Credits', () => api.onCredits());

  /* ================= right: the board ================= */

  const leaderboard = createLeaderboard(map.id);
  layout.appendChild(leaderboard.element);

  parent.appendChild(root);

  const api: StartScreen = {
    // Replaced below, once startRun exists to point it at.
    startImmediately: () => undefined,
    onPlay: () => undefined,
    onCredits: () => undefined,
    onSettings: () => undefined,
    onIdentityChange: () => undefined,
    setScores(scores) {
      leaderboard.render(scores);
    },
    show() {
      renderBest();
      nameInput.value = score.name;
      body.sync(score.colour);
      printInput.value = score.print;
      printColour.sync(score.printColour);
      hem.input.value = String(score.hem);
      sleeve.input.value = String(score.sleeve);
      printSize.input.value = String(score.printScale);
      if (score.shirt) shirtColour.sync(score.shirt);
      paintShirtControls();
      paintPrintControls();
      paintSuggestions();
      leaderboard.setHighlight(score.name);
      root.style.display = 'flex';
      preview.setAppearance(appearanceOf(score));
      // Only turns while it can be seen. It is a second WebGL context with its
      // own animation mixer, and leaving it running behind a hidden overlay
      // would take frames from the run in front of it.
      preview.start();
      // Fetched every time the screen appears, not once at startup: between one
      // run and the next, the person on the laptop opposite has been playing too.
      void leaderboard.refresh();
    },
    hide() {
      root.style.display = 'none';
      preview.stop();
    },
  };

  // The screen is up from the moment it is built — its own CSS says so — but
  // nothing used to say it out loud, so everything show() does on the way in
  // was skipped on the one appearance every player is guaranteed to see.
  api.show();

  const startRun = (): void => {
    const name = nameInput.value.trim() || 'Player';
    if (name !== score.name) {
      score.name = name;
      leaderboard.setHighlight(name);
      changed();
    }
    api.hide();
    api.onPlay();
  };

  api.startImmediately = startRun;
  playBtn.addEventListener('click', startRun);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startRun();
  });

  return api;
}
