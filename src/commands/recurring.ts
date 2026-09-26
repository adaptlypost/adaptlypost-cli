import type { Command } from "commander";

import {
  deleteRecurringPost,
  getRecurringPost,
  listRecurringPosts,
  pauseRecurringPost,
  resumeRecurringPost,
} from "../api/client.js";
import {
  RECURRING_POST_STATUSES,
  type PlatformType,
  type Recurrence,
  type RecurringPost,
  type RecurringPostStatus,
} from "../api/types.js";
import {
  CliError,
  ExitCode,
  formatAbsolute,
  formatId,
  formatRelative,
  isMachine,
  isQuiet,
  paginateAll,
  print,
  printFieldHints,
  printKeyValues,
  printResult,
  printTable,
  promptConfirm,
  success,
  validateLimit,
  validateOffset,
} from "../core/index.js";

const UNITS: Record<Recurrence["frequency"], [string, string]> = {
  DAILY: ["daily", "days"],
  WEEKLY: ["weekly", "weeks"],
  MONTHLY: ["monthly", "months"],
};

type RecurrenceSummary = Pick<Recurrence, "frequency"> & {
  interval?: number | null;
  weekdays?: readonly string[] | null;
  endsOn?: string | null;
  maxOccurrences?: number | null;
};

export function describeRecurrence(recurrence: RecurrenceSummary): string {
  const [adverb, unit] = UNITS[recurrence.frequency];
  const interval = recurrence.interval ?? 1;
  const parts = [interval > 1 ? `every ${interval} ${unit}` : adverb];

  if (recurrence.weekdays?.length) parts.push(`on ${recurrence.weekdays.join(", ")}`);
  if (recurrence.endsOn) parts.push(`until ${recurrence.endsOn.slice(0, 10)}`);
  if (recurrence.maxOccurrences) parts.push(`for ${recurrence.maxOccurrences} posts`);

  return parts.join(" ");
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

const oneLine = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim() || "—";

const platformsOf = (recurring: RecurringPost): PlatformType[] => [
  ...new Set([
    ...(recurring.platformTypes ?? []),
    ...(recurring.platforms ?? []).map((target) => target.platform),
  ]),
];

const whenOf = (value: string | null | undefined, timezone: string): string => {
  if (!value) return "—";
  const date = new Date(value);
  return `${formatAbsolute(date, { timezone })} (${formatRelative(date)})`;
};

interface GlobalOptions {
  yes?: boolean;
  quiet?: boolean;
}

interface ListOptions extends GlobalOptions {
  limit?: string;
  offset?: string;
  all?: boolean;
  status: string[];
}

async function runList(options: ListOptions): Promise<void> {
  const statuses = options.status.map((value) => {
    const status = value.trim().toUpperCase() as RecurringPostStatus;
    if (!(RECURRING_POST_STATUSES as readonly string[]).includes(status)) {
      throw new CliError(
        `Unknown status "${value}". Expected one of: ${RECURRING_POST_STATUSES.join(", ")}.`,
        { exitCode: ExitCode.USAGE },
      );
    }
    return status;
  });

  const limit = options.limit === undefined ? 20 : validateLimit(options.limit, 1, 100);
  const offset = validateOffset(options.offset);
  const query = { statuses: statuses.length > 0 ? statuses : undefined };

  let recurringPosts: RecurringPost[];
  let total: number | undefined;
  let hasMore = false;

  if (options.all) {
    const paged = await paginateAll<RecurringPost>({
      pageSize: 100,
      offset,
      quiet: Boolean(options.quiet) || isQuiet(),
      fetchPage: async (page) => {
        const response = await listRecurringPosts({ ...query, limit: page.limit, offset: page.offset });
        return { items: response.recurringPosts, total: response.total, hasMore: response.hasMore };
      },
    });
    recurringPosts = paged.items;
    total = paged.total;
  } else {
    const response = await listRecurringPosts({ ...query, limit, offset });
    recurringPosts = response.recurringPosts;
    total = response.total;
    hasMore = response.hasMore;
  }

  if (isMachine()) {
    printResult("recurring.list", recurringPosts, {
      total,
      limit: options.all ? undefined : limit,
      offset: options.all ? undefined : offset,
      hasMore,
    });
    printFieldHints(recurringPosts);
    return;
  }

  if (recurringPosts.length === 0) {
    print("No recurring posts match those filters.");
    return;
  }

  printTable(recurringPosts, [
    { header: "ID", value: (recurring) => formatId(recurring.id) },
    { header: "STATUS", value: (recurring) => recurring.status },
    { header: "REPEATS", value: (recurring) => describeRecurrence(recurring) },
    {
      header: "NEXT",
      value: (recurring) =>
        recurring.nextOccurrenceAt
          ? formatAbsolute(new Date(recurring.nextOccurrenceAt), {
              timezone: recurring.timezone || "UTC",
              withZone: false,
            })
          : "—",
    },
    { header: "POSTS", value: (recurring) => recurring.occurrenceCount, align: "right" },
    { header: "PLATFORMS", value: (recurring) => platformsOf(recurring).join(", ") || "—" },
    { header: "TEXT", value: (recurring) => oneLine(recurring.text) },
  ]);

  print("");
  print(`${recurringPosts.length} of ${total ?? recurringPosts.length}`);

  if (hasMore) print(`next: --offset ${offset + recurringPosts.length}`);
}

function summaryOf(recurring: RecurringPost): [string, string][] {
  const timezone = recurring.timezone || "UTC";
  const entries: [string, string][] = [["status", recurring.status]];

  if (recurring.pauseReason) entries.push(["paused by", recurring.pauseReason]);
  if (recurring.lastError) entries.push(["last error", recurring.lastError]);

  entries.push(["repeats", describeRecurrence(recurring)]);
  entries.push(["starts", whenOf(recurring.startsAt, timezone)]);
  entries.push(["next", whenOf(recurring.nextOccurrenceAt, timezone)]);
  entries.push(["posts", String(recurring.occurrenceCount)]);
  return entries;
}

async function runView(id: string): Promise<void> {
  const recurring = await getRecurringPost(id);

  if (isMachine()) {
    printResult("recurring.view", recurring);
    return;
  }

  print(recurring.id);
  printKeyValues([
    ...summaryOf(recurring),
    ["type", recurring.contentType],
    ["text", oneLine(recurring.text)],
  ]);

  const targets = recurring.platforms ?? [];
  if (targets.length === 0) return;

  print("");
  printTable(targets, [
    { header: "PLATFORM", value: (target) => target.platform },
    { header: "ACCOUNT", value: (target) => target.accountName ?? target.connectionId ?? target.pageId ?? "—" },
  ]);
}

async function runPause(id: string): Promise<void> {
  const recurring = await pauseRecurringPost(id);

  if (isMachine()) {
    printResult("recurring.pause", recurring);
    return;
  }

  success(`Paused  ${formatId(recurring.id)}`);
  printKeyValues([...summaryOf(recurring), ["resume", `adaptlypost recurring resume ${recurring.id}`]]);
}

async function runResume(id: string): Promise<void> {
  const recurring = await resumeRecurringPost(id);

  if (isMachine()) {
    printResult("recurring.resume", recurring);
    return;
  }

  success(`Resumed  ${formatId(recurring.id)}`);
  printKeyValues(summaryOf(recurring));
}

async function runDelete(id: string, options: GlobalOptions): Promise<void> {
  if (!options.yes) {
    const recurring = await getRecurringPost(id);
    const platforms = platformsOf(recurring).join(" + ") || "no platforms";
    const proceed = await promptConfirm(
      `Delete ${formatId(recurring.id)} (${recurring.status}, ${describeRecurrence(recurring)}, ${platforms}) and its upcoming scheduled post?`,
      { assumeYes: Boolean(options.yes) },
    );
    if (!proceed) {
      throw new CliError("Cancelled.", { exitCode: ExitCode.CANCELLED });
    }
  }

  const deleted = await deleteRecurringPost(id);

  if (isMachine()) {
    printResult("recurring.delete", deleted);
    return;
  }

  success("Deleted");
}

export function registerRecurringCommands(program: Command): void {
  const recurring = program
    .command("recurring")
    .description("Inspect, pause, resume and delete recurring posts. Create one with post create --repeat");

  recurring
    .command("list")
    .alias("ls")
    .description("List recurring posts in this workspace")
    .option("--limit <n>", "Recurring posts per page, 1 to 100")
    .option("--offset <n>", "Recurring posts to skip")
    .option("--all", "Page until the server runs out")
    .option("--status <status>", `Filter by status (${RECURRING_POST_STATUSES.join(", ")}), repeatable`, collect, [])
    .action(async (_options: ListOptions, command: Command) => {
      await runList(command.optsWithGlobals() as ListOptions);
    });

  recurring
    .command("view <id>")
    .alias("get")
    .description("Show one recurring post with its schedule and targets")
    .action(async (id: string) => {
      await runView(id);
    });

  recurring
    .command("pause <id>")
    .description("Stop creating posts and delete the upcoming scheduled post")
    .action(async (id: string) => {
      await runPause(id);
    });

  recurring
    .command("resume <id>")
    .description("Continue from the next slot after now. Slots missed while paused are skipped")
    .action(async (id: string) => {
      await runResume(id);
    });

  recurring
    .command("delete <id>")
    .alias("rm")
    .description("Stop the series and delete its upcoming scheduled post. Published posts stay")
    .action(async (id: string, _options: GlobalOptions, command: Command) => {
      await runDelete(id, command.optsWithGlobals() as GlobalOptions);
    });
}
