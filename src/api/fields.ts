import { CliError } from '../core/errors.js';
import { ExitCode } from '../core/exit-codes.js';

export function requireField<T>(value: T | null | undefined, field: string): T {
  if (value === undefined || value === null) {
    throw new CliError(`The API response has no ${field}.`, {
      exitCode: ExitCode.GENERIC,
      code: 'unexpected_response',
    });
  }
  return value;
}
