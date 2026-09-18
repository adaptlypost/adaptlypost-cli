import { describe, expect, it } from "vitest";
import {
  ApiError,
  CliError,
  exitCodeFor,
  flattenApiMessage,
  isApiError,
  isCliError,
  toErrorPayload,
  usageError,
} from "../../src/core/errors.js";
import { ExitCode, exitCodeName, httpStatusToExitCode } from "../../src/core/exit-codes.js";

describe("httpStatusToExitCode", () => {
  it("maps every documented status", () => {
    expect(httpStatusToExitCode(200)).toBe(ExitCode.OK);
    expect(httpStatusToExitCode(400)).toBe(ExitCode.VALIDATION);
    expect(httpStatusToExitCode(401)).toBe(ExitCode.AUTH);
    expect(httpStatusToExitCode(403)).toBe(ExitCode.AUTH);
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
    expect(exitCodeName(42)).toBeUndefined();
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
