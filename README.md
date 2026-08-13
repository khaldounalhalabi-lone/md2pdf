# md2pdf

Turn a Markdown file — including its `plantuml` code fences — into a single-page
PDF. Diagrams are rendered by [plantuml.com](https://plantuml.com) and inlined
as SVG, GitHub-flavored Markdown is styled with `@deno/gfm`, and headless Chrome
prints the result onto one tall page with no page breaks.

```text
  md2pdf  report.md → report.pdf

  ✓ Reading markdown    3 diagrams found
  ✓ Rendering diagrams  3/3
  ✓ Printing PDF        headless chrome

  Done  report.pdf  (248.3 KB in 4.2s)
```

> **Before publishing this repo** — two things to fix first.

**1. Set the real repository.** The install commands below use a placeholder,
and the installers refuse to run against it rather than fetching a 404:

```bash
sed -i 's|YOUR-USER/md-to-pdf|<owner>/<repo>|g' README.md install.sh install.ps1
```

The URLs point at the `master` branch, matching this repo. If you push to `main`
instead, swap that too (or pass `MD2PDF_BRANCH=main`).

**2. Stop tracking the compiled binary.** `md2pdf` is 121 MB — over GitHub's 100
MB per-file limit — and is in the initial commit, so a push will be rejected. It
is in `.gitignore` now, but that does not untrack it:

```bash
git rm --cached md2pdf
git commit --amend      # the binary is only in the one commit so far
```

## Install

No clone required — the installers fetch the source themselves.

### Linux (Ubuntu / Debian) and macOS

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.sh | bash
```

### Windows (PowerShell 5.1+)

```powershell
irm https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.ps1 | iex
```

Either one installs [Deno](https://deno.com) first if it is missing, installs
the `md2pdf` command, offers to put it on your `PATH`, and finishes by running
`md2pdf --version` to prove it works. Nothing is written outside your home
directory, and every change is asked about first — add `-y` (or `-Yes`) for an
unattended install.

### Install options

Pass options through the pipe:

```bash
# standalone ~120 MB binary — no Deno needed to run it
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.sh | bash -s -- --compile

# unattended, custom location and command name
curl -fsSL .../install.sh | bash -s -- --yes --root ~/.local --name md2pdf
```

```powershell
# PowerShell needs the script turned into a scriptblock to accept arguments
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.ps1))) -Compile
```

| Option (bash / PowerShell)     | What it does                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `--compile` / `-Compile`       | Build a standalone binary (~120 MB) instead of a small Deno-managed command   |
| `--root DIR` / `-Root DIR`     | Install root; the command lands in `DIR/bin`                                  |
| `--name NAME` / `-Name NAME`   | Rename the command                                                            |
| `--source URL` / `-Source URL` | Install from a different `main.ts` (a fork, a branch, a local path)           |
| `--uninstall` / `-Uninstall`   | Remove it again                                                               |
| `-y`, `--yes` / `-Yes`         | Answer yes to every prompt                                                    |
| `-h`, `--help`                 | Show the installer's own help (bash; use `Get-Help .\install.ps1` on Windows) |

`MD2PDF_REPO`, `MD2PDF_BRANCH` and `MD2PDF_SOURCE` override where the source is
fetched from, which is handy for forks:

```bash
curl -fsSL .../install.sh | MD2PDF_REPO=me/my-fork bash
```

### Without the installer

Deno can install the command directly, since dependencies are pinned inside the
source rather than in an import map:

```bash
deno install -grfA --name md2pdf https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/main.ts
```

### From a clone

Running the installer inside a checkout points the command at that folder's
`main.ts` instead of a URL, so `git pull` is enough to update it — just don't
move the folder afterwards.

```bash
git clone https://github.com/YOUR-USER/md-to-pdf.git && cd md-to-pdf
./install.sh
```

## Usage

```bash
md2pdf <input.md> [output.pdf]     # output defaults to <input>.pdf next to the input
md2pdf report.md -o out.pdf --width 1100 --override
md2pdf                             # asks for everything
```

| Option              | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `-o, --output`      | Output path (alternative to the second argument)          |
| `-w, --width`       | Content column width in px (default: 900)                 |
| `-y, --override`    | Overwrite the output file if it exists (alias: `--force`) |
| `-i, --interactive` | Ask for every option that was not passed                  |
| `-q, --quiet`       | Only print errors; never prompts                          |
| `-h, --help`        | Show help                                                 |
| `-V, --version`     | Show the version                                          |

### Interactive mode

Run `md2pdf` with no input file — or with `--interactive` — and it asks for what
it needs, pre-filling sensible defaults:

```text
? Input markdown file (number or path) [report.md]
  › 
? Output PDF [report.pdf]
  › 
? Content width in px [900]
  ›
```

The input question lists the Markdown files in the current directory so you can
answer with a number, or type/paste a path (`~` and quotes are handled). If the
output file already exists you are asked before anything is overwritten; answer
`n` to give a different path instead. With no terminal attached — a pipe, a CI
job, or `--quiet` — nothing is asked and the run fails with a clear message.

Progress goes to stderr, so piping stays clean, and the spinner degrades to
plain lines when it isn't printing to a terminal.

## Requirements

- **Deno 2** — installed automatically by the installers.
- **Internet access** for `plantuml` fences; a diagram that fails to render is
  left in the PDF as plain text and reported at the end, rather than failing the
  whole run.
- **Chrome or Chromium** — Astral uses an installed one, or downloads a headless
  build into its cache on first use.

## Update / uninstall

```bash
# installed from a URL: re-run the installer
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.sh | bash

# installed from a clone
git pull                       # a URL-less install already points at your checkout

# remove it
./install.sh --uninstall       # or: curl -fsSL .../install.sh | bash -s -- --uninstall
```

```powershell
.\install.ps1 -Uninstall
```

## Development

```bash
deno task dev                       # watch mode
deno task start examples/sample.md  # run once
deno task compile                   # standalone binary in ./md2pdf
deno check main.ts mod.ts
deno fmt && deno lint
```

```text
├── main.ts            CLI entry point — kept at the root so a raw URL installs
├── mod.ts             library entry point (re-exports the pipeline)
├── src/
│   ├── cli.ts         argument parsing, prompts, progress rendering
│   ├── ui.ts          terminal output: spinner steps, questions, formatting
│   ├── convert.ts     mdToPDF(): the pipeline, start to finish
│   ├── markdown.ts    Markdown → HTML, with diagrams inlined as SVG
│   ├── plantuml.ts    diagram source → SVG via plantuml.com
│   ├── pdf.ts         HTML → single-page PDF via headless Chrome
│   └── progress.ts    the ProgressEvent type both sides agree on
├── examples/
│   └── sample.md      demo document with a diagram
├── install.sh         installer for Linux / macOS
└── install.ps1        installer for Windows
```

Only `cli.ts` and `ui.ts` touch the terminal; the pipeline reports through
`onProgress` events and prints nothing, so it can be driven from your own
script:

```ts
import { mdToPDF } from "./mod.ts";

await mdToPDF("examples/sample.md", "sample.pdf", {
  pageWidth: 1100,
  onProgress: (event) => console.log(event.kind),
});
```

Dependencies are pinned with `jsr:` / `npm:` specifiers inside the source rather
than in `deno.json`, which is what lets a raw URL work as an install entry
point.

`deno task compile` drops its binary in the repo root, and generated PDFs tend
to land there too; both are already covered by `.gitignore`.
