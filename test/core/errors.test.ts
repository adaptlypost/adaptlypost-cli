import { describe, expect, it } from "vitest";
import {
  ApiError,
  CliError,
  accessHintFor,
  exitCodeFor,
  flattenApiMessage,
  isApiError,
  isCliError,
  readAccessDenial,
  toErrorPayload,
  usageError,
} from "../../src/core/errors.js";
import { EXIT_CODE_MEANINGS, ExitCode, exitCodeName, httpStatusToExitCode } from "../../src/core/exit-codes.js";

describe("httpStatusToExitCode", () => {
  it("maps every documented status", () => {
    expect(httpStatusToExitCode(200)).toBe(ExitCode.OK);
    expect(httpStatusToExitCode(400)).toBe(ExitCode.VALIDATION);
    expect(httpStatusToExitCode(401)).toBe(ExitCode.AUTH);
    expect(httpStatusToExitCode(403)).toBe(ExitCode.FORBIDDEN);
    expect(httpStatusToExitCode(403, "permission_denied")).toBe(ExitCode.FORBIDDEN);
    expect(httpStatusToExitCode(403, "subscription_required")).toBe(ExitCode.QUOTA);
    expect(httpStatusToExitCode(401, "token_issuer_lost_access")).toBe(ExitCode.AUTH);
    expect(httpStatusToExitCode(402)).toBe(ExitCode.QUOTA);
    expect(httpStatusToExitCode(404)).toBe(ExitCode.NOT_FOUND);
    expect(httpStatusToExitCode(409)).toBe(ExitCode.CONFLICT);
    expect(httpStatusToExitCode(429)).toBe(ExitCode.RATE_LIMITED);
    expect(httpStatusToExitCode(422)).toBe(ExitCode.VALIDATION);
    expect(httpStatusToExitCode(500)).toBe(ExitCode.GENERIC);
    expect(httpStatusToExitCode(503)).toBe(ExitCode.GENERIC);
  });

  it("names a code", () => {
    expect(exitCodeName(130)).toBe("CANCELLED");
    expect(exitCodeName(10)).toBe("FORBIDDEN");
    expect(exitCodeName(42)).toBeUndefined();
  });

  it("gives every exit code a meaning", () => {
    for (const value of Object.values(ExitCode)) {
      expect(EXIT_CODE_MEANINGS[value]).toBeTruthy();
    }
    expect(EXIT_CODE_MEANINGS[10]).toMatch(/permission denied/i);
  });
});

describe("access denials", () => {
  const denied = {
    statusCode: 403,
    error: "Forbidden",
    code: "permission_denied",
    requiredPermission: "posts.publish",
    role: "contributor",
    tokenType: "api_token",
    message: "Contributors cannot publish. Save the post as a draft instead.",
  };

  it("reads the role, the permission and the token type from the 403 body", () => {
    expect(readAccessDenial(denied)).toEqual({
      requiredPermission: "posts.publish",
      role: "contributor",
      tokenType: "api_token",
    });
    expect(readAccessDenial("nope")).toEqual({});
  });

  it("exits 10 with a hint that names the role and the permission", () => {
    const error = new ApiError({ status: 403, body: denied, method: "POST", path: "/social-posts/p1/publish" });
    expect(error.exitCode).toBe(ExitCode.FORBIDDEN);
    expect(error.code).toBe("permission_denied");
    expect(error.message).toBe("Contributors cannot publish. Save the post as a draft instead.");
    expect(error.hint).toContain("contributor");
    expect(error.hint).toContain("posts.publish");
    expect(error.hint).toContain("Ask a workspace admin");
    expect(toErrorPayload(error)).toMatchObject({ code: "permission_denied", status: 403 });
  });

  it("tells an OAuth grant to change its role rather than its key", () => {
    const hint = accessHintFor(403, "permission_denied", { ...denied, tokenType: "oauth" });
    expect(hint).toContain("Your role is contributor");
    expect(hint).toContain("change your role");
    expect(hint).not.toContain("key");
  });

  it("still asks an admin when the body carries no role", () => {
    const hint = accessHintFor(403, "permission_denied", { code: "permission_denied" });
    expect(hint).toContain("does not allow this");
    expect(hint).toContain("Ask a workspace admin");
  });

  it("maps a subscription 403 to the plan exit code", () => {
    const error = new ApiError({ status: 403, body: { code: "subscription_required", message: "Plan not active" } });
    expect(error.exitCode).toBe(ExitCode.QUOTA);
    expect(error.hint).toContain("plan");
  });

  it("keeps a plain 403 on the permission exit code without a hint", () => {
    const error = new ApiError({ status: 403, body: { message: "Forbidden" } });
    expect(error.exitCode).toBe(ExitCode.FORBIDDEN);
    expect(error.code).toBe("forbidden");
    expect(error.hint).toBeUndefined();
  });

  it("explains a key whose creator lost access", () => {
    const error = new ApiError({
      status: 401,
      body: { code: "token_issuer_lost_access", message: "The key's creator no longer has access" },
    });
    expect(error.exitCode).toBe(ExitCode.AUTH);
    expect(error.code).toBe("token_issuer_lost_access");
    expect(error.hint).toContain("no longer has access");
    expect(error.hint).toContain("Ask a workspace admin for a new key");
  });

  it("leaves a plain 401 without a hint", () => {
    expect(new ApiError({ status: 401, body: { message: "Unauthorized" } }).hint).toBeUndefined();
    expect(accessHintFor(404, "not_found", {})).toBeUndefined();
  });

  it("keeps an explicit hint over the derived one", () => {
    const error = new ApiError({ status: 403, body: denied, hint: "custom" });
    expect(error.hint).toBe("custom");
  });
});

describe("CliError", () => {
  it("defaults to the generic exit code", () => {
    const error = new CliError("something broke");
    expect(error.exitCode).toBe(ExitCode.GENERIC);
    expect(error.code).toBe("error");
    expect(isCliError(error)).toBe(true);
  });

  it("derives a code from the exit code", () => {
    expect(usageError("bad flag").code).toBe("usage_error");
    expect(usageError("bad flag").exitCode).toBe(ExitCode.USAGE);
  });

  it("carries a hint and details", () => {
    const error = new CliError("nope", { exitCode: ExitCode.VALIDATION, hint: "try this", details: [1] });
    expect(error.hint).toBe("try this");
    expect(toErrorPayload(error)).toEqual({
      code: "validation_error",
      status: null,
      message: "nope",
      details: [1],
    });
  });
});

describe("ApiError", () => {
  it("flattens the NestJS string[] message and keeps the array in details", () => {
    const error = new ApiError({
      status: 400,
      body: { statusCode: 400, message: ["text must be a string", "scheduledAt must be ISO"], error: "Bad Request" },
    });
    expect(error.message).toBe("text must be a string; scheduledAt must be ISO");
    expect(error.details).toEqual(["text must be a string", "scheduledAt must be ISO"]);
    expect(error.exitCode).toBe(ExitCode.VALIDATION);
    expect(error.code).toBe("bad_request");
    expect(isApiError(error)).toBe(true);
  });

  it("uses a plain string message", () => {
    const error = new ApiError({ status: 404, body: { message: "Post not found" } });
    expect(error.message).toBe("Post not found");
    expect(error.code).toBe("not_found");
    expect(error.exitCode).toBe(ExitCode.NOT_FOUND);
  });

  it("slugifies the NestJS error title into a code", () => {
    const error = new ApiError({ status: 400, body: { message: "bad", error: "Bad Request" } });
    expect(error.code).toBe("bad_request");
  });

  it("prefers an explicit code from the body", () => {
    const error = new ApiError({ status: 409, body: { code: "duplicate_webhook", message: "already exists" } });
    expect(error.code).toBe("duplicate_webhook");
    expect(error.exitCode).toBe(ExitCode.CONFLICT);
  });

  it("carries the request id and the parsed body", () => {
    const body = { message: "nope", requestId: "req_123" };
    const error = new ApiError({ status: 500, body, method: "GET", path: "/social-posts" });
    expect(error.requestId).toBe("req_123");
    expect(error.body).toBe(body);
    expect(error.exitCode).toBe(ExitCode.GENERIC);
    expect(error.code).toBe("internal_server_error");
  });

  it("falls back to the status when there is no body", () => {
    const error = new ApiError({ status: 502 });
    expect(error.message).toBe("HTTP 502");
    expect(error.body).toBeNull();
  });

  it("reports the machine payload shape", () => {
    const error = new ApiError({ status: 404, body: { message: "Post not found" } });
    expect(toErrorPayload(error)).toEqual({
      code: "not_found",
      status: 404,
      message: "Post not found",
      details: null,
    });
  });
});

describe("flattenApiMessage", () => {
  it("reads a bare string body", () => {
    expect(flattenApiMessage("Upstream failure")).toEqual({ message: "Upstream failure", details: null });
  });

  it("reads a nested error object", () => {
    expect(flattenApiMessage({ error: { message: "bad token" } })).toEqual({
      message: "bad token",
      details: null,
    });
  });

  it("returns nulls for an unknown shape", () => {
    expect(flattenApiMessage({ nothing: true })).toEqual({ message: null, details: null });
  });
});

describe("exitCodeFor", () => {
  it("maps network failures", () => {
    const abort = new Error("aborted");
    abort.name = "TimeoutError";
    expect(exitCodeFor(abort)).toBe(ExitCode.NETWORK);
    expect(exitCodeFor(new TypeError("fetch failed"))).toBe(ExitCode.NETWORK);
  });

  it("falls back to the generic code", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(ExitCode.GENERIC);
    expect(exitCodeFor("boom")).toBe(ExitCode.GENERIC);
  });

  it("builds a payload for an unknown throw", () => {
    expect(toErrorPayload("boom")).toEqual({ code: "error", status: null, message: "boom", details: null });
  });
});
