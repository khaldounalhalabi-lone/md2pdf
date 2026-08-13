/**
 * Command-line front end: argument parsing, interactive prompts, and the
 * progress rendering for a conversion run.
 */
// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import {
  bold,
  cyan,
  dim,
  green,
  magenta,
  yellow,
} from "jsr:@std/fmt@^1/colors";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
} from "jsr:@std/path@^1";
import { DEFAULT_PAGE_WIDTH_PX, mdToPDF } from "./convert.ts";
import type { ProgressEvent } from "./progress.ts";
import {
  ask,
  askYesNo,
  canPrompt,
  die,
  formatBytes,
  formatDuration,
  retry,
  Step,
  write,
} from "./ui.ts";

export const NAME = "md2pdf";
export const VERSION = "1.0.0";
const MIN_WIDTH = 200;

// ── Small helpers ─────────────────────────────────────────────────────────

/** Show paths relative to the cwd when that is shorter than the absolute one. */
function shorten(path: string): string {
  const rel = relative(Deno.cwd(), path);
  return rel && !rel.startsWith("..") && rel.length < path.length ? rel : path;
}

function statOrNull(path: string): Deno.FileInfo | null {
  try {
    return Deno.statSync(path);
  } catch {
    return null;
  }
}

/**
 * Make sure the output is actually named like a PDF.
 *
 * Typing `test.md` — or a bare name — at the output prompt is easy to do, and
 * silently writing PDF bytes into a `.md` file helps nobody. Returns the fixed
 * path, or null when it was already fine.
 */
function asPdfPath(path: string): string | null {
  const ext = extname(path);
  if (ext.toLowerCase() === ".pdf") return null;
  return (ext ? path.slice(0, -ext.length) : path) + ".pdf";
}

/** Paths pasted from a file manager arrive quoted and/or with a ~ prefix. */
function normalizePath(input: string): string {
  let value = input.trim().replace(/^(['"])(.*)\1$/, "$2");
  const home = Deno.env.get("HOME");
  if (home && (value === "~" || value.startsWith("~/"))) {
    value = home + value.slice(1);
  }
  return resolve(value);
}

// ── Prompts specific to this tool ─────────────────────────────────────────

/** Markdown files in the cwd, offered as a numbered pick list. */
function markdownFilesInCwd(): string[] {
  try {
    return [...Deno.readDirSync(Deno.cwd())]
      .filter((entry) => entry.isFile && /\.(md|markdown)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .slice(0, 9);
  } catch {
    return [];
  }
}

function promptForInput(): string {
  const candidates = markdownFilesInCwd();
  if (candidates.length > 0) {
    write(`\n  ${dim("Markdown files here:")}\n`);
    for (const [index, name] of candidates.entries()) {
      write(`      ${cyan(String(index + 1))}  ${name}\n`);
    }
  }

  while (true) {
    const answer = ask("Input markdown file", {
      hint: candidates.length > 0 ? "(number or path)" : "(path)",
      fallback: candidates.length === 1 ? candidates[0] : undefined,
    });
    if (answer === "") {
      retry("An input file is required.");
      continue;
    }

    const pick = Number(answer);
    const path =
      Number.isInteger(pick) && pick >= 1 && pick <= candidates.length
        ? resolve(candidates[pick - 1])
        : normalizePath(answer);

    const stat = statOrNull(path);
    if (!stat) {
      retry(`No such file: ${path}`);
      continue;
    }
    if (!stat.isFile) {
      retry(`Not a file: ${path}`);
      continue;
    }
    return path;
  }
}

function promptForWidth(): number {
  while (true) {
    const answer = ask("Content width in px", {
      fallback: String(DEFAULT_PAGE_WIDTH_PX),
    });
    const width = Number(answer);
    if (Number.isFinite(width) && width >= MIN_WIDTH) return width;
    retry(`Expected a number ≥ ${MIN_WIDTH}.`);
  }
}

// ── Help ──────────────────────────────────────────────────────────────────

function helpText(): string {
  return `
  ${bold(magenta(NAME))} ${dim(`v${VERSION}`)}  ${
    dim("— Markdown (with PlantUML diagrams) → single-page PDF")
  }

  ${bold("USAGE")}
    ${cyan(NAME)} ${green("<input.md>")} ${dim("[output.pdf] [options]")}
    ${cyan(NAME)}                      ${
    dim("— asks for everything interactively")
  }

  ${bold("ARGUMENTS")}
    ${green("<input.md>")}       Markdown file to convert
    ${dim("[output.pdf]")}     Where to write the PDF ${
    dim("(default: alongside the input)")
  }

  ${bold("OPTIONS")}
    ${cyan("-o, --output")}     Output path ${
    dim("(alternative to the 2nd argument)")
  }
    ${cyan("-w, --width")}      Content column width in px ${
    dim(`(default: ${DEFAULT_PAGE_WIDTH_PX})`)
  }
    ${cyan("-y, --override")}   Overwrite the output file if it exists ${
    dim("(alias: --force)")
  }
    ${cyan("-i, --interactive")} Ask for every option that was not passed
    ${cyan("-q, --quiet")}      Only print errors ${
    dim("(never prompts; fails instead)")
  }
    ${cyan("-h, --help")}       Show this help
    ${cyan("-V, --version")}    Show the version

  ${bold("INTERACTIVE MODE")}
    Running ${cyan(NAME)} with no input file — or with ${
    cyan("--interactive")
  } — asks for the
    input (pick a number from the markdown files in the current directory, or
    type a path), the output path, and the page width. Whenever the output
    already exists you are asked before it is overwritten, unless ${
    cyan("--override")
  }
    was passed. With no TTY (pipes, CI) nothing is asked and the run fails
    with a clear message instead.

  ${bold("EXAMPLES")}
    ${dim("$")} ${cyan(NAME)}
    ${dim("$")} ${cyan(NAME)} report.md
    ${dim("$")} ${cyan(NAME)} docs/design.md build/design.pdf
    ${dim("$")} ${cyan(NAME)} report.md -o out.pdf --width 1100 --override

  ${bold("NOTES")}
    Fenced ${
    cyan("```plantuml")
  } blocks are rendered via plantuml.com and inlined
    as SVG, so an internet connection is required for diagrams. Everything is
    printed onto one tall page — no page breaks.
`;
}

// ── Options: flags, then questions for whatever is left ───────────────────

interface RunOptions {
  inputPath: string;
  outputPath: string;
  pageWidth: number;
  quiet: boolean;
}

function collectOptions(args: string[]): RunOptions | null {
  const flags = parseArgs(args, {
    string: ["output", "width"],
    boolean: ["help", "version", "quiet", "override", "interactive"],
    alias: {
      output: "o",
      width: "w",
      help: "h",
      version: "V",
      quiet: "q",
      override: ["y", "f", "force"],
      interactive: "i",
    },
    unknown: (arg: string) => {
      if (arg.startsWith("-")) {
        die(
          `Unknown option ${bold(arg)}`,
          `Run ${NAME} --help to see the options.`,
        );
      }
      return true;
    },
  });

  if (flags.help) {
    console.log(helpText());
    return null;
  }
  if (flags.version) {
    console.log(`${NAME} ${VERSION}`);
    return null;
  }

  const quiet = flags.quiet;
  const [inputArg, outputArg] = flags._.map(String);
  // Prompt when explicitly asked, or when the one required argument is absent.
  // --quiet is a promise of silence, so it never prompts.
  const interactive = !quiet && canPrompt() &&
    (flags.interactive || inputArg === undefined);

  if (!quiet && interactive) {
    write(
      `\n  ${bold(magenta(NAME))} ${dim(`v${VERSION}`)}  ${
        dim("markdown → single-page PDF")
      }\n`,
    );
  }

  // ── input
  let inputPath: string;
  if (inputArg !== undefined) {
    inputPath = normalizePath(inputArg);
    const stat = statOrNull(inputPath);
    if (!stat) die(`No such file: ${bold(inputArg)}`);
    if (!stat.isFile) die(`${bold(inputArg)} is not a file`);
  } else if (interactive) {
    inputPath = promptForInput();
  } else {
    console.log(helpText());
    Deno.exit(1);
  }

  // ── output
  const defaultOutput = join(
    dirname(inputPath),
    `${basename(inputPath, extname(inputPath))}.pdf`,
  );
  let outputPath = normalizePath(flags.output ?? outputArg ?? defaultOutput);

  // ── width
  let pageWidth = DEFAULT_PAGE_WIDTH_PX;
  if (flags.width !== undefined) {
    pageWidth = Number(flags.width);
    if (!Number.isFinite(pageWidth) || pageWidth < MIN_WIDTH) {
      die(
        `Invalid --width ${bold(String(flags.width))}`,
        `Expected a number ≥ ${MIN_WIDTH}.`,
      );
    }
  }

  if (interactive) {
    if (flags.output === undefined && outputArg === undefined) {
      outputPath = normalizePath(
        ask("Output PDF", { fallback: shorten(defaultOutput) }),
      );
    }
    if (flags.width === undefined) pageWidth = promptForWidth();
  }

  // ── the output is a PDF whatever it was called
  const corrected = asPdfPath(outputPath);
  if (corrected) {
    if (!quiet) {
      write(
        `\n  ${yellow("!")} ${dim("Writing")} ${shorten(corrected)} ${
          dim(`— the output of ${NAME} is always a PDF`)
        }\n`,
      );
    }
    outputPath = corrected;
  }

  // ── overwrite guard: ask when we can, fail loudly when we cannot
  let override = flags.override;
  while (!override && statOrNull(outputPath)) {
    if (!canPrompt() || quiet) {
      die(
        `Output already exists: ${bold(shorten(outputPath))}`,
        "Pass --override to overwrite it.",
      );
    }
    if (askYesNo(`${shorten(outputPath)} exists — overwrite it?`, false)) {
      override = true;
    } else {
      outputPath = normalizePath(ask("Output PDF", { hint: "(new path)" }));
    }
  }

  return { inputPath, outputPath, pageWidth, quiet };
}

// ── Conversion + progress rendering ───────────────────────────────────────

async function convert(options: RunOptions) {
  const { inputPath, outputPath, pageWidth, quiet } = options;
  const started = performance.now();

  if (!quiet) {
    write(
      `\n  ${bold(magenta(NAME))}  ${cyan(shorten(inputPath))} ${dim("→")} ${
        green(shorten(outputPath))
      }\n\n`,
    );
  }

  // One step per phase; diagram fetches report into the middle step.
  let step = quiet ? null : new Step("Reading markdown");
  let diagramsDone = 0;
  let diagramsFailed = 0;
  let diagramTotal = 0;
  const notices: string[] = [];

  const onProgress = (event: ProgressEvent) => {
    if (quiet) return;
    switch (event.kind) {
      case "parsed":
        diagramTotal = event.diagrams;
        step?.done(
          diagramTotal === 0
            ? "no diagrams"
            : `${diagramTotal} diagram${diagramTotal === 1 ? "" : "s"} found`,
        );
        step = new Step(
          diagramTotal === 0 ? "Rendering markdown" : "Rendering diagrams",
        );
        break;
      case "diagram":
        if (event.error) diagramsFailed++;
        diagramsDone++;
        step?.update(`${diagramsDone}/${event.total}`);
        break;
      case "rendered":
        if (diagramsFailed > 0) {
          step?.warn(
            `${
              diagramsDone - diagramsFailed
            }/${diagramTotal} ok, ${diagramsFailed} failed`,
          );
        } else {
          step?.done(
            diagramTotal === 0 ? "" : `${diagramTotal}/${diagramTotal}`,
          );
        }
        step = null;
        break;
      case "printing":
        step = new Step("Printing PDF");
        break;
      case "printed":
        step?.done(
          notices.length > 0
            ? "headless chrome, no sandbox"
            : "headless chrome",
        );
        step = null;
        break;
      case "notice":
        // Printing now would fight the spinner; keep it for the summary.
        notices.push(event.message);
        break;
    }
  };

  let bytes: number;
  try {
    bytes = await mdToPDF(inputPath, outputPath, { pageWidth, onProgress });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    step?.fail(message);
    die("Conversion failed", message);
  }

  if (!quiet) {
    const elapsed = formatDuration(performance.now() - started);
    write(
      `\n  ${bold(green("Done"))}  ${shorten(outputPath)}  ${
        dim(`(${formatBytes(bytes)} in ${elapsed})`)
      }\n\n`,
    );
    if (diagramsFailed > 0) {
      write(
        `  ${yellow("!")} ${diagramsFailed} diagram${
          diagramsFailed === 1 ? " was" : "s were"
        } left as plain text — check your network or diagram syntax.\n\n`,
      );
    }
    for (const notice of notices) {
      write(`  ${yellow("!")} ${dim(notice)}\n\n`);
    }
  }
}

/** Entry point used by the root `main.ts`. */
export async function runCli(args: string[] = Deno.args) {
  const options = collectOptions(args);
  if (options) await convert(options);
}
