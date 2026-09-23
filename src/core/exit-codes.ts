export const ExitCode = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  VALIDATION: 5,
  CONFLICT: 6,
  RATE_LIMITED: 7,
  NETWORK: 8,
  QUOTA: 9,
  FORBIDDEN: 10,
  CANCELLED: 130,
} as const;

export type ExitCodeName = keyof typeof ExitCode;
export type ExitCodeValue = (typeof ExitCode)[ExitCodeName];

export const EXIT_CODE_MEANINGS: Record<ExitCodeValue, string> = {
  0: "Success",
  1: "Generic failure, including 5xx",
  2: "Usage error",
  3: "Auth failure",
  4: "Not found",
  5: "Validation or other 4xx",
  6: "Conflict",
  7: "Rate limited",
  8: "Network failure or timeout",
  9: "Quota or plan limit",
  10: "Permission denied: the key is valid but its role cannot do this",
  130: "Interrupted",
};

export const API_CODE_PERMISSION_DENIED = "permission_denied";
export const API_CODE_SUBSCRIPTION_REQUIRED = "subscription_required";
export const API_CODE_TOKEN_ISSUER_LOST_ACCESS = "token_issuer_lost_access";

export function httpStatusToExitCode(status: number, apiCode?: string): ExitCodeValue {
  if (status >= 200 && status < 400) return ExitCode.OK;
  switch (status) {
    case 401:
      return ExitCode.AUTH;
    case 403:
      return apiCode === API_CODE_SUBSCRIPTION_REQUIRED ? ExitCode.QUOTA : ExitCode.FORBIDDEN;
    case 402:
      return ExitCode.QUOTA;
    case 404:
      return ExitCode.NOT_FOUND;
    case 409:
      return ExitCode.CONFLICT;
    case 429:
      return ExitCode.RATE_LIMITED;
    default:
      break;
  }
  if (status >= 500) return ExitCode.GENERIC;
  if (status >= 400) return ExitCode.VALIDATION;
  return ExitCode.GENERIC;
}

export function exitCodeName(code: number): ExitCodeName | undefined {
  for (const [name, value] of Object.entries(ExitCode)) {
    if (value === code) return name as ExitCodeName;
  }
  return undefined;
}
