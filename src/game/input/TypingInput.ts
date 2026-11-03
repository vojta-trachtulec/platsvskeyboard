/**
 * Vstup z klávesnice pro hru, odolný vůči českému rozložení.
 *
 * - Znaky bere z události `input` skrytého <input> (funguje s mrtvými klávesami ˇ ´,
 *   Z/Y prohozením i libovolným rozložením OS — porovnáváme znaky, ne fyzické klávesy).
 * - `keydown` slouží jen pro Backspace / Escape a pro časové značky.
 * - Každý úhoz dostane časovou značku performance.now() pro metriky a detekci podvodů.
 */

export interface TypingHandlers {
  onChar: (ch: string, t: number) => void;
  onBackspace?: (t: number) => void;
  onEscape?: () => void;
  onTab?: (t: number) => void;
  onRestart?: () => void;
}

export class TypingInput {
  private el: HTMLInputElement;
  private handlers: TypingHandlers;
  private composing = false;
  private disposed = false;
  private paused = false;
  private capturing = true;

  constructor(container: HTMLElement, handlers: TypingHandlers) {
    this.handlers = handlers;
    const el = document.createElement("input");
    el.type = "text";
    el.autocomplete = "off";
    el.autocapitalize = "off";
    el.spellcheck = false;
    el.setAttribute("aria-label", "Vstup pro psaní");
    Object.assign(el.style, {
      position: "absolute",
      opacity: "0",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(el);
    this.el = el;

    el.addEventListener("compositionstart", this.onCompStart);
    el.addEventListener("compositionend", this.onCompEnd);
    el.addEventListener("input", this.onInput);
    el.addEventListener("keydown", this.onKeyDown);
    el.addEventListener("blur", this.refocusSoon);
    container.addEventListener("pointerdown", this.focus);
    window.addEventListener("focus", this.focus);
    this.focus();
  }

  focus = () => {
    if (!this.disposed && !this.paused && this.capturing) this.el.focus({ preventScroll: true });
  };

  private refocusSoon = () => {
    if (this.disposed || this.paused || !this.capturing) return;
    setTimeout(this.focus, 0);
  };

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.el.blur();
    } else {
      this.focus();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  disableCapture() {
    this.capturing = false;
    this.el.blur();
  }

  enableCapture() {
    this.capturing = true;
    this.focus();
  }

  isCapturing(): boolean {
    return this.capturing && !this.disposed;
  }

  private onCompStart = () => {
    if (!this.capturing) return;
    this.composing = true;
  };

  private onCompEnd = (e: CompositionEvent) => {
    if (!this.capturing) return;
    this.composing = false;
    this.emitText(e.data ?? "");
    this.el.value = "";
  };

  private onInput = (e: Event) => {
    if (!this.capturing) return;
    if (this.paused) {
      this.el.value = "";
      return;
    }
    const ev = e as InputEvent;
    if (this.composing || ev.isComposing) return;
    if (ev.inputType === "insertText" || ev.inputType === "insertFromPaste") {
      // insertFromPaste záměrně nepočítáme jako úhozy
      if (ev.inputType === "insertText") this.emitText(ev.data ?? "");
    }
    this.el.value = "";
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.capturing || e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.handlers.onEscape?.();
      return;
    }
    // Rychlý restart klávesou F2 nebo Ctrl+R
    if (e.key === "F2" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"))) {
      e.preventDefault();
      this.handlers.onRestart?.();
      return;
    }
    if (this.paused) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      this.handlers.onBackspace?.(performance.now());
    } else if (e.key === "Tab") {
      e.preventDefault();
      const t = performance.now();
      this.handlers.onTab?.(t);
      this.handlers.onChar("Tab", t);
    }
  };

  private emitText(text: string) {
    const t = performance.now();
    for (const ch of text.normalize("NFC")) {
      if (ch === "\n" || ch === "\r") continue;
      this.handlers.onChar(ch, t);
    }
  }

  dispose() {
    this.disposed = true;
    this.el.removeEventListener("compositionstart", this.onCompStart);
    this.el.removeEventListener("compositionend", this.onCompEnd);
    this.el.removeEventListener("input", this.onInput);
    this.el.removeEventListener("keydown", this.onKeyDown);
    this.el.removeEventListener("blur", this.refocusSoon);
    this.el.parentElement?.removeEventListener("pointerdown", this.focus);
    window.removeEventListener("focus", this.focus);
    this.el.remove();
  }
}
