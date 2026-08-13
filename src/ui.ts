/**
 * Terminal presentation: everything that writes to the screen or reads an
 * answer from the user. Kept apart from the conversion pipeline so the latter
 * stays silent and testable.
 *
 * Progress goes to stderr, so piping the tool's output stays clean, and every
 * animation degrades to plain lines when stderr is not a terminal.
 */
// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { bold, cyan, dim, green, red, yellow } from "jsr:@std/fmt@^1/colors";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function write(text: string) {
  Deno.stderr.writeSync(encoder.encode(text));
}

/**
 * A single line of progress: spins while the step runs, then settles into a
 * ✓/✗ line with an optional trailing detail.
 */
export class Step {
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Print a red error (plus an optional hint) and exit non-zero. */
export function die(message: string, hint?: string): never {
  write(`\n  ${red("✗")} ${message}\n`);
  if (hint) write(`    ${dim(hint)}\n`);
  write("\n");
  Deno.exit(1);
}

// ── Prompts ───────────────────────────────────────────────────────────────

/** Questions are only possible with a terminal on both ends. */
export function canPrompt(): boolean {
  return Deno.stdin.isTerminal() && Deno.stderr.isTerminal();
}

/** Blocking read of one line from stdin; null on EOF (Ctrl-D). */
function readLine(): string | null {
  const buf = new Uint8Array(1024);
  let out = "";
  while (true) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) return out.length > 0 ? out : null;
    out += decoder.decode(buf.subarray(0, n));
    const newline = out.indexOf("\n");
    if (newline >= 0) return out.slice(0, newline).replace(/\r$/, "");
  }
}

function cancelled(): never {
  write(`\n  ${dim("Cancelled.")}\n\n`);
  Deno.exit(130);
}

/**
 * Ask a question and return the trimmed answer, or the default when the user
 * just hits Enter. Aborts the program on EOF.
 */
export function ask(
  question: string,
  options: { fallback?: string; hint?: string } = {},
): string {
  const hint = options.hint ? ` ${dim(options.hint)}` : "";
  const fallback = options.fallback ? dim(` [${options.fallback}]`) : "";
  write(
    `\n  ${cyan("?")} ${bold(question)}${hint}${fallback}\n    ${dim("›")} `,
  );
  const answer = readLine();
  if (answer === null) cancelled();
  const value = answer.trim();
  return value === "" ? options.fallback ?? "" : value;
}

/** Yes/no question. `fallback` is what an empty answer means. */
export function askYesNo(question: string, fallback: boolean): boolean {
  while (true) {
    const answer = ask(question, { hint: fallback ? "(Y/n)" : "(y/N)" })
      .toLowerCase();
    if (answer === "") return fallback;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    write(`    ${yellow("!")} ${dim("Please answer y or n.")}\n`);
  }
}

/** Complain about an answer without abandoning the question. */
export function retry(message: string) {
  write(`    ${yellow("!")} ${dim(message)}\n`);
}
