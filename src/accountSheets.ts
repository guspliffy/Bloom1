import type { Hud } from './hud';
import { COPY, accountMessage } from './net/board';
import type { Player } from './net/online';
import type { Social } from './social';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Mode = 'create' | 'signin';

const TEXT: Record<Mode, { title: string; go: string; hint: string; swap: string }> = {
  create: { title: 'Your name', go: 'Keep my name', hint: '3 to 16 letters. No email, just a name to keep.', swap: 'I already have a name' },
  signin: { title: 'Welcome back', go: 'Sign in', hint: 'Same name and password as your other device.', swap: "I'm new here" },
};

/** The name sheet (GDD §8 "Account flow"): never a modal, never offered on open; one message line, replaced each time. */
export class NameSheet {
  private mode: Mode = 'create';
  private busy = false;
  private form = $<HTMLFormElement>('name-form');
  private name = $<HTMLInputElement>('name-input');
  private pass = $<HTMLInputElement>('pass-input');
  private msg = $('name-msg');
  private go = $<HTMLButtonElement>('btn-name-go');

  /** `onDone` runs after a successful sign-up or sign-in: the sheet has closed and the board should open on the own row. */
  constructor(
    private hud: Hud,
    private social: Social,
    private onDone: (p: Player) => void,
  ) {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    $('btn-name-mode').addEventListener('click', () => this.setMode(this.mode === 'create' ? 'signin' : 'create'));
  }

  open(mode: Mode = 'create'): void {
    this.setMode(mode);
    this.msg.textContent = '';
    this.pass.value = '';
    this.hud.showSheet('namesheet');
    this.name.focus({ preventScroll: true });
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    const t = TEXT[mode];
    $('name-title').textContent = t.title;
    this.go.textContent = t.go;
    $('name-hint').textContent = t.hint;
    $('btn-name-mode').textContent = t.swap;
    this.pass.autocomplete = mode === 'create' ? 'new-password' : 'current-password';
    this.msg.textContent = '';
  }

  private say(text: string): void {
    this.msg.textContent = text;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.go.disabled = true;
    try {
      const o = this.social.online;
      const res = this.mode === 'create' ? await o.createAccount(this.name.value, this.pass.value) : await o.signIn(this.name.value, this.pass.value);
      if (!res.ok) {
        this.say(accountMessage(res, navigator.onLine === false));
        return;
      }
      this.social.setPlayer(res.player);
      this.pass.value = '';
      this.hud.toast(`Welcome, ${res.player.name}.`);
      this.onDone(res.player);
    } catch {
      this.say(COPY.outOfReach);
    } finally {
      this.busy = false;
      this.go.disabled = false;
    }
  }
}

/** The member's sheet: their name, one calm line, back to the garden, and a quiet "Sign out". */
export class SignOutSheet {
  constructor(
    private hud: Hud,
    private social: Social,
  ) {
    $('btn-signout-back').addEventListener('click', () => this.hud.closeSheets());
    $('btn-signout').addEventListener('click', () => void this.signOut());
  }

  open(): void {
    $('who').textContent = this.social.player?.name ?? '';
    this.hud.showSheet('signout');
  }

  private async signOut(): Promise<void> {
    await this.social.online.signOut();
    this.social.setPlayer(null);
    this.hud.closeSheets();
  }
}
