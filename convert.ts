import { launch } from "@astral/astral";
import { CSS, render } from "@deno/gfm";
import { deflateSync } from "fflate";

const PLANTUML_SERVER = "https://www.plantuml.com/plantuml/svg";
const DEFAULT_PAGE_WIDTH_PX = 900; // content column width; paper width is derived from it
const PX_PER_INCH = 96; // CSS reference pixel density used by Chrome's PDF engine

// ── Progress reporting ────────────────────────────────────────────────────
// The library never writes to the console; it emits events and lets the
// caller (the CLI) decide how to render them.

export type ProgressEvent =
  | { kind: "parsed"; diagrams: number }
  | { kind: "diagram"; index: number; total: number; error?: string }
  | { kind: "rendered" }
  | { kind: "printing" }
  | { kind: "printed"; bytes: number };

export interface ConvertOptions {
  pageWidth?: number;
  onProgress?: (event: ProgressEvent) => void;
}

// ── PlantUML text encoding ────────────────────────────────────────────────
// The PlantUML server accepts a diagram as raw-DEFLATE bytes re-encoded with
// PlantUML's own 6-bit alphabet (NOT standard base64). fflate's `deflateSync`
// emits raw DEFLATE (no zlib header), which is exactly what the server wants.
// See: https://plantuml.com/text-encoding

function encode6bit(value: number): string {
  if (value < 10) return String.fromCharCode(48 + value); // 0-9
  value -= 10;
  if (value < 26) return String.fromCharCode(65 + value); // A-Z
  value -= 26;
  if (value < 26) return String.fromCharCode(97 + value); // a-z
  value -= 26;
  if (value === 0) return "-";
  if (value === 1) return "_";
  return "?";
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return (
    encode6bit(c1 & 0x3f) +
    encode6bit(c2 & 0x3f) +
    encode6bit(c3 & 0x3f) +
    encode6bit(c4 & 0x3f)
  );
}

function encodePlantumlBytes(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;
    out += append3bytes(b1, b2, b3);
  }
  return out;
}

async function plantumlToSvg(source: string): Promise<string> {
  const deflated = deflateSync(new TextEncoder().encode(source));
  const encoded = encodePlantumlBytes(deflated);
  const response = await fetch(`${PLANTUML_SERVER}/${encoded}`);
  if (!response.ok) {
    throw new Error(
      `PlantUML server returned ${response.status} ${response.statusText}`,
    );
  }
  const svg = await response.text();
  // Strip the XML prolog / DOCTYPE so the SVG can be inlined inside <body>.
  const svgStart = svg.indexOf("<svg");
  return svgStart >= 0 ? svg.slice(svgStart) : svg;
}

// ── Markdown → HTML (diagrams inlined) ────────────────────────────────────

const PLANTUML_FENCE = /```plantuml\s*\n([\s\S]*?)```/g;

async function markdownToHtml(
  markdown: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<string> {
  // Walk the file splitting on plantuml fences. Text spans are rendered with
  // gfm; diagram spans are fetched as SVG and inlined. Diagrams are fetched in
  // parallel.
  type Segment =
    | { kind: "markdown"; value: string }
    | { kind: "diagram"; source: string };

  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of markdown.matchAll(PLANTUML_FENCE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({
        kind: "markdown",
        value: markdown.slice(lastIndex, start),
      });
    }
    segments.push({ kind: "diagram", source: match[1] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < markdown.length) {
    segments.push({ kind: "markdown", value: markdown.slice(lastIndex) });
  }

  const total = segments.filter((segment) => segment.kind === "diagram").length;
  onProgress({ kind: "parsed", diagrams: total });

  let diagramIndex = 0;
  const rendered = await Promise.all(
    segments.map(async (segment): Promise<string> => {
      if (segment.kind === "markdown") {
        return render(segment.value);
      }
      const index = ++diagramIndex;
      try {
        const svg = await plantumlToSvg(segment.source);
        onProgress({ kind: "diagram", index, total });
        return `<div class="diagram">${svg}</div>`;
      } catch (error) {
        onProgress({
          kind: "diagram",
          index,
          total,
          error: error instanceof Error ? error.message : String(error),
        });
        return `<div class="diagram diagram--error"><pre>${
          escapeHtml(
            segment.source,
          )
        }</pre></div>`;
      }
    }),
  );

  return rendered.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildDocument(bodyHtml: string, pageWidth: number): string {
  return `<!DOCTYPE html>
<html data-color-mode="light" data-light-theme="light">
<head>
  <meta charset="utf-8" />
  <style>
    ${CSS}
    html, body { margin: 0; padding: 0; background: #ffffff; }
    .page {
      box-sizing: border-box;
      width: ${pageWidth}px;
      padding: 40px;
    }
    .markdown-body { font-size: 14px; }
    .diagram {
      margin: 20px 0;
      text-align: center;
      page-break-inside: avoid;
    }
    .diagram svg { max-width: 100%; height: auto; }
    .diagram--error pre {
      text-align: left;
      background: #fff5f5;
      border: 1px solid #f0b4b4;
      padding: 12px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="page markdown-body">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// ── HTML → single-page PDF (Astral / headless Chrome) ─────────────────────

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);

    // Measure the rendered content so the paper can be sized to it exactly,
    // collapsing everything onto a single page. This runs inside the browser,
    // so `document` is reached through globalThis (Deno's libs have no DOM).
    const size = await page.evaluate(() => {
      const { document } = globalThis as unknown as {
        document: {
          querySelector: (
            selector: string,
          ) => { scrollWidth: number; scrollHeight: number };
        };
      };
      const el = document.querySelector(".page");
      return { width: el.scrollWidth, height: el.scrollHeight };
    });

    // CDP printToPDF takes inches. Add a hair of height to dodge rounding
    // that would otherwise spill a few pixels onto a second page.
    return await page.pdf({
      paperWidth: size.width / PX_PER_INCH,
      paperHeight: size.height / PX_PER_INCH + 0.05,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      printBackground: true,
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function mdToPDF(
  inputPath: string,
  outputPath: string,
  options: ConvertOptions = {},
): Promise<number> {
  const onProgress = options.onProgress ?? (() => {});
  const markdown = await Deno.readTextFile(inputPath);

  const bodyHtml = await markdownToHtml(markdown, onProgress);
  const html = buildDocument(
    bodyHtml,
    options.pageWidth ?? DEFAULT_PAGE_WIDTH_PX,
  );
  onProgress({ kind: "rendered" });

  onProgress({ kind: "printing" });
  const pdf = await htmlToPdf(html);

  await Deno.writeFile(outputPath, pdf);
  onProgress({ kind: "printed", bytes: pdf.byteLength });
  return pdf.byteLength;
}
