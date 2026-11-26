import type { Command } from "commander";

import { listLabels } from "../api/client.js";
import type { Label } from "../api/types.js";
import {
  PRODUCT,
  hint,
  isMachine,
  print,
  printFieldHints,
  printResult,
  printTable,
  type Column,
} from "../core/index.js";

const LABEL_COLUMNS: Column<Label>[] = [
  { header: "LABEL ID", value: (label) => label.id, align: "left" },
  { header: "NAME", value: (label) => label.name },
  { header: "COLOR", value: (label) => label.color, align: "left" },
];

async function runList(): Promise<void> {
  const { labels } = await listLabels();

  if (isMachine()) {
    printResult("labels.list", labels, {
      total: labels.length,
      hasMore: false,
    });
    printFieldHints(labels);
    return;
  }

  if (labels.length === 0) {
    print("No labels in this workspace.");
    hint(
      "Create labels in the AdaptlyPost app, then put them on posts with --label <labelId>",
    );
    return;
  }

  printTable(labels, LABEL_COLUMNS);
  print();
  print(`${labels.length} ${labels.length === 1 ? "label" : "labels"}`);
  hint(
    `Put one on a post with: ${PRODUCT.binName} post create --label <labelId> …`,
  );
}

export function registerLabelCommands(program: Command): void {
  const labels = program
    .command("labels")
    .alias("label")
    .description("Labels that organise the posts of this workspace");

  labels
    .command("list")
    .alias("ls")
    .description(
      "List the labels of the workspace, sorted by name. Labels are created in the AdaptlyPost app",
    )
    .action(async () => {
      await runList();
    });
}
