import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Label } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", () => ({
  listLabels: vi.fn(),
}));

const client = await import("../../src/api/client.js");
const { registerLabelCommands } = await import("../../src/commands/label.js");
const { initOutput, setOutputMode } = await import("../../src/core/output.js");

const labels: Label[] = [
  { id: "lbl_brand_a", name: "Brand A", color: "#3B82F6" },
  { id: "lbl_launch", name: "Launch", color: "#EF4444" },
];

let stdout: string[] = [];
let stderr: string[] = [];

const build = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.option("--json");
  registerLabelCommands(program);
  return program;
};

const run = (argv: string[]): Promise<unknown> =>
  build().parseAsync(argv, { from: "user" });

beforeEach(() => {
  vi.clearAllMocks();
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  initOutput({ json: true });
});

describe("the labels command tree", () => {
  it("registers list under labels, with the singular and ls aliases", () => {
    const noun = build().commands.find(
      (command) => command.name() === "labels",
    );
    expect(noun?.aliases()).toContain("label");
    expect(noun?.commands.map((command) => command.name())).toEqual(["list"]);
    expect(noun?.commands[0]?.aliases()).toContain("ls");
  });
});

describe("labels list", () => {
  it("prints the labels unmodified", async () => {
    vi.mocked(client.listLabels).mockResolvedValue({ labels });

    await run(["labels", "list"]);

    expect(client.listLabels).toHaveBeenCalledWith();
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      ok: true,
      command: "labels.list",
      data: labels,
      meta: { total: 2, hasMore: false },
    });
  });

  it("prints a table with the full label id, the name and the color", async () => {
    vi.mocked(client.listLabels).mockResolvedValue({ labels });
    setOutputMode("human");

    await run(["labels", "ls"]);

    const lines = stdout.join("").split("\n");
    expect(lines[0]).toMatch(/^LABEL ID\s+NAME\s+COLOR$/);
    expect(lines[1]).toMatch(/^lbl_brand_a\s+Brand A\s+#3B82F6$/);
    expect(lines[2]).toMatch(/^lbl_launch\s+Launch\s+#EF4444$/);
    expect(stdout.join("")).toContain("2 labels");
    expect(stderr.join("")).toContain("--label <labelId>");
  });

  it("says where labels come from when the workspace has none", async () => {
    vi.mocked(client.listLabels).mockResolvedValue({ labels: [] });
    setOutputMode("human");

    await run(["labels", "list"]);

    expect(stdout.join("")).toContain("No labels in this workspace.");
    expect(stderr.join("")).toContain("AdaptlyPost app");
  });
});
