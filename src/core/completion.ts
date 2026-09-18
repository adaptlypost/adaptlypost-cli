import type { Command, Option } from "commander";
import { usageError } from "./errors.js";

export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;

export type Shell = (typeof SHELLS)[number];

export interface CompletionOption {
  flags: string[];
  description: string;
}

export interface CompletionNode {
  name: string;
  path: string[];
  description: string;
  aliases: string[];
  options: CompletionOption[];
  subcommands: CompletionNode[];
}

export interface CompletionOptions {
  name?: string;
}

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

export function assertShell(value: string): Shell {
  if (!isShell(value)) {
    throw usageError(`Unknown shell "${value}".`, `Supported shells: ${SHELLS.join(", ")}.`);
  }
  return value;
}

export function buildCompletionTree(program: Command, options: CompletionOptions = {}): CompletionNode {
  const rootName = options.name ?? program.name();
  return describe(program, [rootName], program);
}

export function generateCompletion(program: Command, shell: Shell, options: CompletionOptions = {}): string {
  const tree = buildCompletionTree(program, options);
  switch (shell) {
    case "bash":
      return bashScript(tree);
    case "zsh":
      return zshScript(tree);
    case "fish":
      return fishScript(tree);
    case "powershell":
      return powershellScript(tree);
    default:
      throw usageError(`Unknown shell "${String(shell)}".`);
  }
}

export function completionInstructions(shell: Shell, name: string): string {
  switch (shell) {
    case "bash":
      return [
        `# Load ${name} completions for the current shell:`,
        `#   eval "$(${name} completion bash)"`,
        "# Or install them permanently:",
        `#   ${name} completion bash > /etc/bash_completion.d/${name}`,
      ].join("\n");
    case "zsh":
      return [
        `# Load ${name} completions for the current shell:`,
        `#   eval "$(${name} completion zsh)"`,
        "# Or install them permanently:",
        `#   ${name} completion zsh > "\${fpath[1]}/_${name}"`,
      ].join("\n");
    case "fish":
      return [
        `# Load ${name} completions for the current shell:`,
        `#   ${name} completion fish | source`,
        "# Or install them permanently:",
        `#   ${name} completion fish > ~/.config/fish/completions/${name}.fish`,
      ].join("\n");
    case "powershell":
      return [
        `# Load ${name} completions for the current session:`,
        `#   ${name} completion powershell | Out-String | Invoke-Expression`,
        "# Or append that line to $PROFILE.",
      ].join("\n");
    default:
      return "";
  }
}

function describe(command: Command, path: string[], program: Command): CompletionNode {
  const help = program.createHelp();
  const globals = typeof help.visibleGlobalOptions === "function" ? help.visibleGlobalOptions(command) : [];
  const options = dedupeOptions([...help.visibleOptions(command), ...globals]);
  const subcommands = help
    .visibleCommands(command)
    .map((child) => describe(child, [...path, child.name()], program));

  return {
    name: command.name(),
    path,
    description: command.description(),
    aliases: command.aliases(),
    options,
    subcommands,
  };
}

function dedupeOptions(options: readonly Option[]): CompletionOption[] {
  const seen = new Set<string>();
  const result: CompletionOption[] = [];
  for (const option of options) {
    const flags = [option.short, option.long].filter((flag): flag is string => typeof flag === "string" && flag !== "");
    if (flags.length === 0) continue;
    const key = flags.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ flags, description: option.description ?? "" });
  }
  return result;
}

function flatten(node: CompletionNode, into: CompletionNode[] = []): CompletionNode[] {
  into.push(node);
  for (const child of node.subcommands) flatten(child, into);
  return into;
}

function wordsOf(node: CompletionNode, root: CompletionNode): string[] {
  const words = new Set<string>();
  for (const child of node.subcommands) {
    words.add(child.name);
    for (const alias of child.aliases) words.add(alias);
  }
  for (const option of node.options) {
    for (const flag of option.flags) words.add(flag);
  }
  if (node !== root) {
    for (const option of root.options) {
      for (const flag of option.flags) words.add(flag);
    }
  }
  return [...words];
}

function keyOf(node: CompletionNode): string {
  return node.path.join(" ");
}

function identifier(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "_");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bashScript(root: CompletionNode): string {
  const id = identifier(root.name);
  const nodes = flatten(root);
  const cases = nodes
    .map((node) => `    ${shellQuote(keyOf(node))}) echo ${shellQuote(wordsOf(node, root).join(" "))} ;;`)
    .join("\n");

  return `_${id}_words() {
  case "$1" in
${cases}
    *) echo "" ;;
  esac
}

_${id}_complete() {
  local cur key next word i
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  key=${shellQuote(root.name)}
  for (( i = 1; i < COMP_CWORD; i++ )); do
    word="\${COMP_WORDS[i]}"
    case "$word" in
      -*) continue ;;
    esac
    next="$key $word"
    if [ -n "$(_${id}_words "$next")" ]; then
      key="$next"
    fi
  done
  COMPREPLY=( $(compgen -W "$(_${id}_words "$key")" -- "$cur") )
}

complete -F _${id}_complete ${root.name}
`;
}

function zshScript(root: CompletionNode): string {
  const id = identifier(root.name);
  const nodes = flatten(root);
  const entries = nodes
    .map((node) => `  ${shellQuote(keyOf(node))} ${shellQuote(wordsOf(node, root).join(" "))}`)
    .join("\n");

  return `#compdef ${root.name}

typeset -gA _${id}_tree
_${id}_tree=(
${entries}
)

_${id}() {
  local key next word i
  key=${shellQuote(root.name)}
  for (( i = 2; i < CURRENT; i++ )); do
    word="\${words[i]}"
    case "$word" in
      -*) continue ;;
    esac
    next="$key $word"
    if [[ -n "\${_${id}_tree[$next]}" ]]; then
      key="$next"
    fi
  done
  local -a candidates
  candidates=(\${=_${id}_tree[$key]})
  compadd -a candidates
}

compdef _${id} ${root.name}
`;
}

function fishScript(root: CompletionNode): string {
  const id = identifier(root.name);
  const lines: string[] = [
    `function __fish_${id}_path_is`,
    "    set -l tokens (commandline -opc)",
    "    set -l parts",
    "    for token in $tokens[2..-1]",
    "        if string match -q -- '-*' $token",
    "            continue",
    "        end",
    "        set -a parts $token",
    "    end",
    '    set -l joined (string join " " $parts)',
    '    test "$joined" = "$argv[1]"',
    "end",
    "",
    `complete -c ${root.name} -f`,
  ];

  for (const node of flatten(root)) {
    const prefix = node.path.slice(1).join(" ");
    const condition = `__fish_${id}_path_is ${shellQuote(prefix)}`;
    for (const child of node.subcommands) {
      lines.push(
        `complete -c ${root.name} -n ${shellQuote(condition)} -a ${shellQuote(child.name)} -d ${shellQuote(child.description)}`,
      );
    }
    for (const option of node.options) {
      const long = option.flags.find((flag) => flag.startsWith("--"));
      const short = option.flags.find((flag) => !flag.startsWith("--"));
      const parts = [`complete -c ${root.name} -n ${shellQuote(condition)}`];
      if (short !== undefined) parts.push(`-s ${short.replace(/^-/, "")}`);
      if (long !== undefined) parts.push(`-l ${long.replace(/^--/, "")}`);
      parts.push(`-d ${shellQuote(option.description)}`);
      lines.push(parts.join(" "));
    }
  }

  return `${lines.join("\n")}\n`;
}

function powershellScript(root: CompletionNode): string {
  const id = identifier(root.name);
  const entries = flatten(root)
    .map((node) => {
      const words = wordsOf(node, root).map((word) => `'${word.replace(/'/g, "''")}'`).join(", ");
      return `    '${keyOf(node).replace(/'/g, "''")}' = @(${words})`;
    })
    .join("\n");

  return `$${id}Completions = @{
${entries}
}

Register-ArgumentCompleter -Native -CommandName ${root.name} -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $tokens = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
    $key = '${root.name.replace(/'/g, "''")}'
    for ($i = 1; $i -lt $tokens.Count; $i++) {
        $token = $tokens[$i]
        if ($token.StartsWith('-')) { continue }
        if ($token -eq $wordToComplete) { continue }
        $next = "$key $token"
        if ($${id}Completions.ContainsKey($next)) { $key = $next }
    }
    $${id}Completions[$key] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
}
