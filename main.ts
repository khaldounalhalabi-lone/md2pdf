#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys
import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, dim, green, magenta, red, yellow } from "@std/fmt/colors";
import { basename, dirname, extname, join, resolve } from "@std/path";
import { mdToPDF, type ProgressEvent } from "./convert.ts";

const NAME = "md2pdf";
const VERSION = "1.0.0";

// ── Terminal helpers ──────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const encoder = new TextEncoder();

function write(text: string) {
  Deno.stderr.writeSync(encoder.encode(text));
}

/**
 * A single line of progress: spins while the step runs, then settles into a
 * ✓/✗ line with an optional trailing detail. Falls back to plain, non-animated
 * lines when stderr is not a TTY (pipes, CI logs).
 */
class Step {
  #timer: ReturnType<typeof setInterval> | undefined;
  #frame = 0;
  #label: string;
  #detail = "";
  #tty = Deno.stderr.isTerminal();

  constructor(label: string) {
    this.#label = label;
    if (this.#tty) {
      this.#render();
      this.#timer = setInterval(() => {
        this.#frame = (this.#frame + 1) % SPINNER_FRAMES.length;
        this.#render();
      }, 80);
    } else {
      write(`  … ${label}\n`);
    }
  }

  #render() {
    const spinner = cyan(SPINNER_FRAMES[this.#frame]);
    const detail = this.#detail ? `  ${dim(this.#detail)}` : "";
    write(`\r\x1b[2K  ${spinner} ${this.#label}${detail}`);
  }

  /** Update the greyed-out detail shown next to the label. */
  update(detail: string) {
    this.#detail = detail;
    if (this.#tty) this.#render();
  }

  #settle(mark: string, label: string, detail: string) {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    const tail = detail ? `  ${dim(detail)}` : "";
    const line = `  ${mark} ${label}${tail}\n`;
    write(this.#tty ? `\r\x1b[2K${line}` : line);
  }

  done(detail = this.#detail) {
    this.#settle(green("✓"), this.#label, detail);
  }

  warn(detail: string) {
    this.#settle(yellow("!"), this.#label, detail);
  }

  fail(detail: string) {
    this.#settle(red("✗"), this.#label, detail);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function helpText(): string {
  return `
  ${bold(magenta("md2pdf"))} ${dim(`v${VERSION}`)}  ${
    dim("— Markdown (with PlantUML diagrams) → single-page PDF")
  }

  ${bold("USAGE")}
    ${cyan(NAME)} ${green("<input.md>")} ${dim("[output.pdf]")}
    ${cyan(NAME)} ${green("<input.md>")} ${dim("-o")} ${dim("<output.pdf>")}

  ${bold("ARGUMENTS")}
    ${green("<input.md>")}     Markdown file to convert
    ${dim("[output.pdf]")}   Where to write the PDF ${
    dim("(default: alongside the input)")
  }

  ${bold("OPTIONS")}
    ${cyan("-o, --output")}   Output path ${
    dim("(alternative to the 2nd argument)")
  }
    ${cyan("-w, --width")}    Content column width in px ${
    dim("(default: 900)")
  }
    ${cyan("-f, --force")}    Overwrite the output file if it already exists
    ${cyan("-q, --quiet")}    Only print errors
    ${cyan("-h, --help")}     Show this help
    ${cyan("-V, --version")}  Show the version

  ${bold("EXAMPLES")}
    ${dim("$")} ${cyan(NAME)} report.md
    ${dim("$")} ${cyan(NAME)} docs/design.md build/design.pdf
    ${dim("$")} ${cyan(NAME)} report.md -o out.pdf --width 1100 --force

  ${bold("NOTES")}
    Fenced ${
    cyan("```plantuml")
  } blocks are rendered via plantuml.com and inlined
    as SVG, so an internet connection is required for diagrams. Everything is
    printed onto one tall page — no page breaks.
`;
}

function die(message: string, hint?: string): never {
  write(`\n  ${red("✗")} ${message}\n`);
  if (hint) write(`    ${dim(hint)}\n`);
  write("\n");
  Deno.exit(1);
}

// ── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(Deno.args, {
    string: ["output", "width"],
    boolean: ["help", "version", "quiet", "force"],
    alias: {
      o: "output",
      w: "width",
      h: "help",
      V: "version",
      q: "quiet",
      f: "force",
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
    return;
  }
  if (flags.version) {
    console.log(`${NAME} ${VERSION}`);
    return;
  }

  const [inputArg, outputArg] = flags._.map(String);
  if (!inputArg) {
    console.log(helpText());
    Deno.exit(1);
  }

  const inputPath = resolve(inputArg);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(inputPath);
  } catch {
    die(`No such file: ${bold(inputArg)}`);
  }
  if (!stat.isFile) die(`${bold(inputArg)} is not a file`);

  const outputPath = resolve(
    flags.output ?? outputArg ??
      join(
        dirname(inputPath),
        `${basename(inputPath, extname(inputPath))}.pdf`,
      ),
  );

  if (!flags.force) {
    const exists = await Deno.stat(outputPath).then(() => true, () => false);
    if (exists) {
      die(
        `Output already exists: ${bold(shorten(outputPath))}`,
        "Pass --force to overwrite it.",
      );
    }
  }

  let pageWidth: number | undefined;
  if (flags.width !== undefined) {
    pageWidth = Number(flags.width);
    if (!Number.isFinite(pageWidth) || pageWidth < 200) {
      die(
        `Invalid --width ${bold(String(flags.width))}`,
        "Expected a number ≥ 200.",
      );
    }
  }

  const quiet = flags.quiet;
  const started = performance.now();

  if (!quiet) {
    write(
      `\n  ${bold(magenta("md2pdf"))}  ${cyan(shorten(inputPath))} ${
        dim("→")
      } ${green(shorten(outputPath))}\n\n`,
    );
  }

  // One step per phase; diagram fetches report into the middle step.
  let step = quiet ? null : new Step("Reading markdown");
  let diagramsDone = 0;
  let diagramsFailed = 0;
  let diagramTotal = 0;

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
        step?.done("headless chrome");
        step = null;
        break;
    }
  };

  let bytes: number;
  try {
    bytes = await mdToPDF(inputPath, outputPath, { pageWidth, onProgress });
  } catch (error) {
    step?.fail(error instanceof Error ? error.message : String(error));
    die(
      "Conversion failed",
      error instanceof Error ? error.message : String(error),
    );
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
  }
}

/** Show paths relative to the cwd when that is shorter than the absolute one. */
function shorten(path: string): string {
  const relative = path.startsWith(Deno.cwd() + "/")
    ? path.slice(Deno.cwd().length + 1)
    : path;
  return relative.length < path.length ? relative : path;
}

if (import.meta.main) {
  await main();
}
