import type { ChatMessage } from '../net/multiplayer';

/**
 * Chat, over the shared world's own connection.
 *
 * Deliberately a HUD overlay rather than a panel you open: messages appear at
 * the bottom-left, fade out on their own, and the input only exists while you
 * are typing. In a game where the interesting thing is climbing, chat should
 * never be something to close before you can play.
 */

/** How long a message stays legible before fading, and how long the fade takes. */
const HOLD_MS = 9000;
const FADE_MS = 1200;
/** Messages kept on screen. Older ones are dropped rather than scrolled. */
const MAX_VISIBLE = 8;
const MAX_LENGTH = 200;

export interface Chat {
  readonly isOpen: boolean;
  /** Show a message. Called for everyone's, including this player's own. */
  push(message: ChatMessage): void;
  open(): void;
  close(): void;
  /** Sends what was typed. */
  onSend: ((text: string) => void) | null;
  /**
   * Called when the input opens or closes.
   *
   * The game needs to know: typing means releasing the pointer so the player
   * gets their cursor back, and releasing the pointer is otherwise the signal
   * that a run has ended.
   */
  onOpenChange: ((open: boolean) => void) | null;
}

export function createChat(parent: HTMLElement): Chat {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; left: 12px; bottom: 12px;
    width: min(420px, calc(100vw - 24px));
    display: flex; flex-direction: column; gap: 3px;
    font: 13px/1.45 system-ui, sans-serif; color: #eee;
    pointer-events: none;
  `;
  parent.appendChild(root);

  const log = document.createElement('div');
  log.style.cssText = 'display: flex; flex-direction: column; gap: 3px;';
  root.appendChild(log);

  const form = document.createElement('form');
  form.style.cssText = 'display: none; margin-top: 4px; pointer-events: auto;';
  const field = document.createElement('input');
  field.type = 'text';
  field.maxLength = MAX_LENGTH;
  field.placeholder = 'Say something — Enter to send, Esc to cancel';
  field.style.cssText = `
    width: 100%; box-sizing: border-box; padding: 6px 9px;
    background: rgba(8,12,20,0.85); color: inherit;
    border: 1px solid #4a8fe7; border-radius: 5px; font: inherit;
    outline: none;
  `;
  form.appendChild(field);
  root.appendChild(form);

  let open = false;
  /** Timers that fade each line out, so closing does not leave them frozen. */
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const api: Chat = {
    get isOpen() {
      return open;
    },
    onSend: null,
    onOpenChange: null,

    push(message) {
      const line = document.createElement('div');
      line.style.cssText = `
        max-width: 100%; padding: 3px 8px; border-radius: 5px;
        background: rgba(8,12,20,0.6);
        overflow-wrap: anywhere;
        transition: opacity ${FADE_MS}ms linear;
      `;

      const who = document.createElement('span');
      who.textContent = message.name;
      who.style.cssText = `color: ${message.colour}; font-weight: 700;`;

      const said = document.createElement('span');
      // Both the name and the message are player-supplied and both are set as
      // text. Nothing here is ever parsed as markup.
      said.textContent = `: ${message.text}`;

      line.append(who, said);
      log.appendChild(line);

      while (log.childElementCount > MAX_VISIBLE) log.firstElementChild?.remove();

      const fade = setTimeout(() => {
        pending.delete(fade);
        line.style.opacity = '0';
        const remove = setTimeout(() => {
          pending.delete(remove);
          line.remove();
        }, FADE_MS);
        pending.add(remove);
      }, HOLD_MS);
      pending.add(fade);
    },

    open() {
      if (open) return;
      open = true;
      form.style.display = 'block';
      field.value = '';
      field.focus();
      api.onOpenChange?.(true);
    },

    close() {
      if (!open) return;
      open = false;
      form.style.display = 'none';
      field.blur();
      api.onOpenChange?.(false);
    },
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = field.value;
    api.close();
    if (text.trim()) api.onSend?.(text);
  });

  field.addEventListener('keydown', (e) => {
    // Handled here rather than on window, so Escape closes the chat instead of
    // reaching the handler that ends the run.
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
    }
  });

  return api;
}
