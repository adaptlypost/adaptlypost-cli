import { cyan, green, red } from './color.js';
import { isMachine, isQuiet } from './output.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let enabled = true;

export function setSpinnersEnabled(value: boolean): void {
  enabled = value;
}

export function spinnersEnabled(): boolean {
  return enabled && Boolean(process.stderr.isTTY) && !process.env.CI && !isQuiet() && !isMachine();
}

export interface Spinner {
  update(text: string): Spinner;
  stop(text?: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
}

export function spinner(text: string): Spinner {
  let label = text;
  let frame = 0;
  const active = spinnersEnabled();
  const render = () => {
    process.stderr.write(`\r\u001b[2K${cyan(FRAMES[frame++ % FRAMES.length])} ${label}`);
  };
  const timer = active ? setInterval(render, 80) : undefined;
  timer?.unref?.();
  if (active) render();
  const clear = () => {
    if (!active) return;
    clearInterval(timer);
    process.stderr.write('\r\u001b[2K');
  };
  return {
    update(next: string) {
      label = next;
      return this;
    },
    stop(final?: string) {
      clear();
      if (active && final) process.stderr.write(`${final}\n`);
    },
    succeed(final?: string) {
      this.stop(green(`✓ ${final ?? label}`));
    },
    fail(final?: string) {
      this.stop(red(`✗ ${final ?? label}`));
    },
  };
}
