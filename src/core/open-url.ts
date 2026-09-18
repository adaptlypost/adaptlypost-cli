import { spawn } from 'node:child_process';

function opener(): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [] };
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''] };
  return { command: 'xdg-open', args: [] };
}

export function canOpenUrl(): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function openUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (!canOpenUrl()) return false;

  const { command, args } = opener();
  try {
    const child = spawn(command, [...args, parsed.toString()], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
