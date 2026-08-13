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

> **Before publishing this repo** — three things to do first.

**1. Set the real repository.** The install commands below use a placeholder,
and the installers refuse to run against it rather than fetching a 404:

```bash
sed -i 's|YOUR-USER/md-to-pdf|<owner>/<repo>|g' README.md install.sh install.ps1
```

The URLs point at the `master` branch, matching this repo. If you push to `main`
instead, swap that too (or pass `MD2PDF_BRANCH=main`).

**2. Get the compiled binary out of git.** `md2pdf` is 121 MB — over GitHub's
100 MB per-file limit — and is committed, so a push will be rejected. It is in
`.gitignore` now, but that does not untrack it, and dropping it from the current
commit is not enough while older commits still carry the blob:

```bash
git rm --cached md2pdf
git commit -m "stop tracking the compiled binary"
git filter-repo --path md2pdf --invert-paths   # purge it from history
```

Nothing is pushed yet, so if `git filter-repo` isn't installed, starting the
history over is just as good:
`rm -rf .git && git init && git add . && git commit`.

**3. Tag a release.** The install commands download prebuilt binaries from the
latest GitHub release; see [Releases](#releases) below. Until one exists, the
scripts fall back to building with Deno.

## Install

One command, no options, nothing to install first — not even Deno. The installer
downloads the prebuilt binary, puts it on your `PATH`, and checks that it runs.

### Linux (Ubuntu / Debian) and macOS

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.sh | bash
```

Lands in `~/.local/bin/md2pdf`, and adds that directory to your `PATH` in
`~/.bashrc`, `~/.zshrc` or `~/.profile` (whichever matches your shell) if it
isn't there already. Open a new terminal — or `source` that file — and `md2pdf`
works from anywhere.

### Windows (PowerShell 5.1+)

```powershell
irm https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.ps1 | iex
```

Lands in `%LOCALAPPDATA%\Programs\md2pdf\md2pdf.exe` and is added to your user
`PATH`. Open a new terminal and `md2pdf` works from anywhere.

Both scripts write only inside your home directory, and re-running one is
harmless — it overwrites the binary and leaves your `PATH` alone if it is
already set. `MD2PDF_REPO=me/my-fork` before the command installs from a fork.

### If you already have Deno

Nothing above needs it, but Deno can install the command straight from source:

```bash
deno install -grfA --name md2pdf https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/main.ts
```

The install scripts also fall back to building with Deno when there is no
release binary for your platform (or no release at all yet) — inside a clone
they build from the checkout, so `./install.sh` works before you ever tag a
release.

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

- **Nothing to install first.** The binary is self-contained — it bundles its
  own runtime, which is why it is 90–120 MB depending on platform. Deno is only
  needed to work on the source.
- **Internet access** for `plantuml` fences; a diagram that fails to render is
  left in the PDF as plain text and reported at the end, rather than failing the
  whole run.
- **Chrome or Chromium** — Astral uses an installed one, or downloads a headless
  build into its cache on first use.

## Update / uninstall

Update by re-running the installer; it fetches the latest release and overwrites
the binary in place.

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.sh | bash
```

To remove it, delete the binary and the `PATH` line the installer added:

```bash
rm ~/.local/bin/md2pdf
# then drop the "# added by the md2pdf installer" lines from ~/.bashrc (or ~/.zshrc, ~/.profile)
```

```powershell
Remove-Item "$env:LOCALAPPDATA\Programs\md2pdf" -Recurse
# then remove that folder from your user PATH (System Properties → Environment Variables)
```

## Releases

The install scripts download from
`https://github.com/<owner>/<repo>/releases/latest/download/…`, so they need a
release with the binaries attached.
[`.github/workflows/release.yml`](.github/workflows/release.yml) builds all six
targets and publishes them when you push a tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

| Asset                        | Platform             |
| ---------------------------- | -------------------- |
| `md2pdf-linux-x86_64`        | Linux, Intel/AMD     |
| `md2pdf-linux-aarch64`       | Linux, ARM           |
| `md2pdf-macos-x86_64`        | macOS, Intel         |
| `md2pdf-macos-aarch64`       | macOS, Apple silicon |
| `md2pdf-windows-x86_64.exe`  | Windows, Intel/AMD   |
| `md2pdf-windows-aarch64.exe` | Windows, ARM         |

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
├── install.ps1        installer for Windows
└── .github/workflows/
    └── release.yml    builds and publishes the release binaries
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
