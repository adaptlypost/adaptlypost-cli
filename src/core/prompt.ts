import { confirm, isCancel, password, select, text } from '@clack/prompts';
import { dim } from './color.js';
import { usageError } from './errors.js';
import { ExitCode } from './exit-codes.js';

let interactive = true;

export function setInteractive(value: boolean): void {
  interactive = value;
}

export function isInteractive(): boolean {
  return interactive && Boolean(process.stdin.isTTY) && !process.env.CI;
}

function requireInteractive(what: string, hint?: string): void {
  if (isInteractive()) return;
  throw usageError(
    `${what} is required and there is no terminal to ask on`,
    hint ?? 'Pass it as a flag, or rerun without --no-input',
  );
}

function cancelled(): never {
  process.stderr.write(dim('Cancelled.\n'));
  process.exit(ExitCode.CANCELLED);
}

export interface HiddenPromptOptions {
  hint?: string;
  validate?: (value: string) => string | undefined;
}

export async function promptHidden(message: string, options: HiddenPromptOptions = {}): Promise<string> {
  requireInteractive(message, options.hint);
  const value = await password({ message, validate: options.validate });
  if (isCancel(value)) cancelled();
  return value as string;
}

export interface TextPromptOptions extends HiddenPromptOptions {
  placeholder?: string;
  initialValue?: string;
}

export async function promptText(message: string, options: TextPromptOptions = {}): Promise<string> {
  requireInteractive(message, options.hint);
  const value = await text({
    message,
    placeholder: options.placeholder,
    initialValue: options.initialValue,
    validate: options.validate,
  });
  if (isCancel(value)) cancelled();
  return value as string;
}

export interface ConfirmPromptOptions {
  initialValue?: boolean;
  assumeYes?: boolean;
  hint?: string;
}

export async function promptConfirm(
  message: string,
  options: ConfirmPromptOptions | boolean = {},
): Promise<boolean> {
  const settings = typeof options === 'boolean' ? { initialValue: options } : options;
  if (settings.assumeYes) return true;
  requireInteractive(message, settings.hint ?? 'Pass --yes to confirm without a prompt');
  const value = await confirm({ message, initialValue: settings.initialValue ?? false });
  if (isCancel(value)) cancelled();
  return value as boolean;
}

export interface SelectChoice<T> {
  value: T;
  label: string;
  hint?: string;
}

export async function promptSelect<T>(
  message: string,
  choices: SelectChoice<T>[],
  options: { initialValue?: T; hint?: string } = {},
): Promise<T> {
  requireInteractive(message, options.hint);
  const ask = select as unknown as (input: {
    message: string;
    options: SelectChoice<T>[];
    initialValue?: T;
  }) => Promise<T | symbol>;
  const value = await ask({ message, options: choices, initialValue: options.initialValue });
  if (isCancel(value)) cancelled();
  return value as T;
}
