import pc from "picocolors";

export interface ColorDetectionInput {
  noColor?: boolean;
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
}

// eslint-disable-next-line no-control-regex -- ESC is the ANSI sequence we strip
const ANSI_PATTERN = /\[[0-9;]*m/g;

let enabled = detectColorEnabled();
let colors = pc.createColors(enabled);

export function detectColorEnabled(input: ColorDetectionInput = {}): boolean {
  if (input.noColor === true) return false;
  const env = input.env ?? process.env;
  if (isSet(env.NO_COLOR)) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    if (force === "" || force === "0" || force.toLowerCase() === "false") return false;
    return true;
  }
  if (env.TERM === "dumb") return false;
  return input.isTTY ?? Boolean(process.stdout.isTTY);
}

export function setColorEnabled(value: boolean): void {
  enabled = value;
  colors = pc.createColors(value);
}

export function isColorEnabled(): boolean {
  return enabled;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function dim(value: string): string {
  return colors.dim(value);
}

export function bold(value: string): string {
  return colors.bold(value);
}

export function red(value: string): string {
  return colors.red(value);
}

export function green(value: string): string {
  return colors.green(value);
}

export function yellow(value: string): string {
  return colors.yellow(value);
}

export function cyan(value: string): string {
  return colors.cyan(value);
}

export function gray(value: string): string {
  return colors.gray(value);
}

export function underline(value: string): string {
  return colors.underline(value);
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}
