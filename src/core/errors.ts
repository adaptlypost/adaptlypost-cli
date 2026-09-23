import {
  API_CODE_PERMISSION_DENIED,
  API_CODE_SUBSCRIPTION_REQUIRED,
  API_CODE_TOKEN_ISSUER_LOST_ACCESS,
  ExitCode,
  httpStatusToExitCode,
  type ExitCodeValue,
} from "./exit-codes.js";

export interface CliErrorOptions {
  exitCode?: ExitCodeValue;
  code?: string;
  hint?: string;
  details?: unknown;
  cause?: unknown;
}

export interface ErrorPayload {
  code: string;
  status: number | null;
  message: string;
  details: unknown;
}

const CODE_FOR_EXIT: Record<ExitCodeValue, string> = {
  0: "ok",
  1: "error",
  2: "usage_error",
  3: "auth_error",
  4: "not_found",
  5: "validation_error",
  6: "conflict",
  7: "rate_limited",
  8: "network_error",
  9: "quota_exceeded",
  10: API_CODE_PERMISSION_DENIED,
  130: "cancelled",
};

export class CliError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliError";
    this.exitCode = options.exitCode ?? ExitCode.GENERIC;
    this.code = options.code ?? CODE_FOR_EXIT[this.exitCode];
    this.hint = options.hint;
    this.details = options.details;
  }
}

export interface ApiErrorInit {
  status: number;
  body?: unknown;
  requestId?: string;
  code?: string;
  message?: string;
  method?: string;
  path?: string;
  hint?: string;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly body: unknown;
  readonly details: string[] | null;
  readonly method?: string;
  readonly path?: string;
  readonly hint?: string;
  readonly exitCode: ExitCodeValue;

  constructor(init: ApiErrorInit) {
    const flat = flattenApiMessage(init.body);
    super(init.message ?? flat.message ?? `HTTP ${init.status}`, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code ?? extractApiCode(init.body) ?? defaultApiCode(init.status);
    this.requestId = init.requestId ?? extractRequestId(init.body);
    this.body = init.body ?? null;
    this.details = flat.details;
    this.method = init.method;
    this.path = init.path;
    this.hint = init.hint ?? accessHintFor(init.status, this.code, init.body);
    this.exitCode = httpStatusToExitCode(init.status, this.code);
  }
}

export interface AccessDenial {
  requiredPermission?: string;
  role?: string;
  tokenType?: string;
}

export function readAccessDenial(body: unknown): AccessDenial {
  if (!isRecord(body)) return {};
  const pick = (key: string): string | undefined => {
    const value = body[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  return { requiredPermission: pick("requiredPermission"), role: pick("role"), tokenType: pick("tokenType") };
}

export function accessHintFor(status: number, code: string, body: unknown): string | undefined {
  if (status === 401 && code === API_CODE_TOKEN_ISSUER_LOST_ACCESS) {
    return "The member who created this key no longer has access to the workspace, so the key stopped working. Ask a workspace admin for a new key.";
  }
  if (status !== 403) return undefined;
  if (code === API_CODE_SUBSCRIPTION_REQUIRED) {
    return "The workspace plan does not cover this. A workspace admin can change the plan in the dashboard.";
  }
  if (code !== API_CODE_PERMISSION_DENIED) return undefined;

  const { requiredPermission, role, tokenType } = readAccessDenial(body);
  const who = tokenType === "oauth" ? "Your role" : "This key's role";
  const lead =
    role !== undefined && requiredPermission !== undefined
      ? `${who} is ${role} and this needs the ${requiredPermission} permission.`
      : requiredPermission !== undefined
        ? `This needs the ${requiredPermission} permission, which ${who.toLowerCase()} does not have.`
        : role !== undefined
          ? `${who} is ${role}, which does not allow this.`
          : `${who} does not allow this.`;
  const ask =
    tokenType === "oauth"
      ? "Ask a workspace admin to change your role."
      : "Ask a workspace admin for a key issued under a role that has it. Retrying or swapping keys of the same role will not help.";
  return `${lead} ${ask}`;
}

export function flattenApiMessage(body: unknown): { message: string | null; details: string[] | null } {
  if (typeof body === "string") {
    const text = body.trim();
    return { message: text === "" ? null : text, details: null };
  }
  if (!isRecord(body)) return { message: null, details: null };

  const raw = body.message ?? body.error_description ?? body.detail;
  if (Array.isArray(raw)) {
    const details = raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (details.length > 0) return { message: details.join("; "), details };
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return { message: raw.trim(), details: null };
  }
  if (isRecord(body.error)) {
    const nested = body.error.message;
    if (typeof nested === "string" && nested.trim() !== "") return { message: nested.trim(), details: null };
  }
  if (typeof body.error === "string" && body.error.trim() !== "") {
    return { message: body.error.trim(), details: null };
  }
  return { message: null, details: null };
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function exitCodeFor(error: unknown): ExitCodeValue {
  if (isApiError(error) || isCliError(error)) return error.exitCode;
  if (isAbortLike(error)) return ExitCode.NETWORK;
  if (error instanceof TypeError && /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
    return ExitCode.NETWORK;
  }
  return ExitCode.GENERIC;
}

export function hintFor(error: unknown): string | undefined {
  if (isCliError(error) || isApiError(error)) return error.hint;
  return undefined;
}

export function messageFor(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  if (typeof error === "string" && error.trim() !== "") return error;
  return "Unexpected error";
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (isApiError(error)) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details ?? null,
    };
  }
  if (isCliError(error)) {
    return {
      code: error.code,
      status: null,
      message: error.message,
      details: error.details ?? null,
    };
  }
  const exitCode = exitCodeFor(error);
  return {
    code: CODE_FOR_EXIT[exitCode],
    status: null,
    message: messageFor(error),
    details: null,
  };
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.USAGE, hint });
}

export function authError(message: string, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.AUTH, hint });
}

export function notFoundError(message: string, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.NOT_FOUND, hint });
}

export function validationError(message: string, details?: unknown, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.VALIDATION, details, hint });
}

export function conflictError(message: string, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.CONFLICT, hint });
}

export function quotaError(message: string, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.QUOTA, hint });
}

export function networkError(message: string, cause?: unknown, hint?: string): CliError {
  return new CliError(message, { exitCode: ExitCode.NETWORK, cause, hint });
}

export function cancelledError(message = "Cancelled"): CliError {
  return new CliError(message, { exitCode: ExitCode.CANCELLED });
}

function extractApiCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.code === "string" && body.code.trim() !== "") return body.code.trim();
  if (isRecord(body.error) && typeof body.error.code === "string" && body.error.code.trim() !== "") {
    return body.error.code.trim();
  }
  if (typeof body.error === "string") {
    const slug = slugify(body.error);
    if (slug !== "") return slug;
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function extractRequestId(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const candidate = body.requestId ?? body.request_id ?? body.traceId;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : undefined;
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  408: "request_timeout",
  409: "conflict",
  410: "gone",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable_entity",
  429: "too_many_requests",
  500: "internal_server_error",
  502: "bad_gateway",
  503: "service_unavailable",
  504: "gateway_timeout",
};

function defaultApiCode(status: number): string {
  return STATUS_CODES[status] ?? `http_${status}`;
}

function isAbortLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
