/**
 * Editor login, client side.
 *
 * Deliberately thin: it asks the server whether this browser may edit, and
 * collects a password when it may not. All verification happens server-side —
 * nothing here decides anything security-relevant, and no secret is ever part
 * of the bundle. The gate that matters is on the save endpoint; this one exists
 * so ordinary visitors never stumble into the editor.
 */

export interface SessionStatus {
  authenticated: boolean;
  /** False when the server has no editor password set — the editor is off entirely. */
  configured: boolean;
  /** True on the Vite dev server, which skips auth so local editing stays frictionless. */
  devMode?: boolean;
}

export async function getSession(): Promise<SessionStatus> {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    if (!res.ok) return { authenticated: false, configured: false };
    return (await res.json()) as SessionStatus;
  } catch {
    return { authenticated: false, configured: false };
  }
}

export async function login(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      const mins = retry ? Math.ceil(Number(retry) / 60) : null;
      return { ok: false, error: mins ? `Too many attempts. Try again in ${mins} min.` : 'Too many attempts.' };
    }
    return { ok: false, error: body.error ?? 'Login failed' };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
}

/**
 * Ask for the editor password. Resolves true once the server accepts it, false
 * if the user backs out. Plain DOM on purpose — this runs before the editor's
 * React bundle is fetched, and pulling in React just to draw one box would
 * defeat the point of lazy-loading the editor at all.
 */
export function promptLogin(parent: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute; inset: 0; z-index: 100;
      background: rgba(8, 10, 14, 0.72); backdrop-filter: blur(2px);
      display: flex; align-items: center; justify-content: center;
      font: 14px system-ui, sans-serif; color: #e8eef5;
    `;

    const card = document.createElement('form');
    card.style.cssText = `
      background: #161b22; border: 1px solid #2b3440; border-radius: 10px;
      padding: 24px 28px; width: 320px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    `;

    const title = document.createElement('div');
    title.textContent = 'Editor';
    title.style.cssText = 'font-size: 18px; font-weight: 700; margin-bottom: 4px;';

    const sub = document.createElement('div');
    sub.textContent = 'Enter the editor password to continue.';
    sub.style.cssText = 'font-size: 12px; opacity: 0.6; margin-bottom: 16px;';

    const field = document.createElement('input');
    field.type = 'password';
    field.autocomplete = 'current-password';
    field.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      background: #0d1117; border: 1px solid #2b3440; border-radius: 6px;
      color: inherit; font: inherit;
    `;

    const error = document.createElement('div');
    error.style.cssText = 'min-height: 18px; margin-top: 8px; font-size: 12px; color: #ff8080;';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Unlock';
    submit.style.cssText = `
      flex: 1; padding: 8px; border: 0; border-radius: 6px;
      background: #2f81f7; color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer;
    `;

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = `
      padding: 8px 14px; border: 1px solid #2b3440; border-radius: 6px;
      background: transparent; color: inherit; font: 14px system-ui, sans-serif; cursor: pointer;
    `;

    const close = (result: boolean): void => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    };

    // Capture phase: the editor and game both listen for bare keys on window,
    // and neither should react to anything typed in here.
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey, true);

    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      submit.textContent = 'Checking…';
      error.textContent = '';

      const result = await login(field.value);

      if (result.ok) {
        close(true);
        return;
      }
      submit.disabled = false;
      submit.textContent = 'Unlock';
      error.textContent = result.error ?? 'Login failed';
      field.select();
    });

    cancel.addEventListener('click', () => close(false));

    row.append(submit, cancel);
    card.append(title, sub, field, error, row);
    backdrop.appendChild(card);
    parent.appendChild(backdrop);
    field.focus();
  });
}
