// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { CSS, render } from "jsr:@deno/gfm@^0.12.0";
import { plantumlToSvg } from "./plantuml.ts";
import type { ProgressListener } from "./progress.ts";

const PLANTUML_FENCE = /```plantuml\s*\n([\s\S]*?)```/g;

/**
 * Render Markdown to HTML, replacing ```plantuml fences with inline SVG.
 *
 * The file is split on those fences: text spans go through gfm, diagram spans
 * are fetched as SVG. Diagrams are fetched in parallel, and one that fails is
 * kept as plain text rather than failing the whole document.
 */
export async function markdownToHtml(
  markdown: string,
  onProgress: ProgressListener,
): Promise<string> {
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
          escapeHtml(segment.source)
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

/** Wrap rendered body HTML in the print stylesheet the PDF is measured against. */
export function buildDocument(bodyHtml: string, pageWidth: number): string {
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
