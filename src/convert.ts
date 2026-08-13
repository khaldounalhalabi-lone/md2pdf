import { buildDocument, markdownToHtml } from "./markdown.ts";
import { htmlToPdf } from "./pdf.ts";
import type { ProgressListener } from "./progress.ts";

/** Content column width in px; the paper width is derived from it. */
export const DEFAULT_PAGE_WIDTH_PX = 900;

export interface ConvertOptions {
  /** Content column width in px. Defaults to {@link DEFAULT_PAGE_WIDTH_PX}. */
  pageWidth?: number;
  /** Called as each stage completes; see `ProgressEvent`. */
  onProgress?: ProgressListener;
}

/**
 * Convert a Markdown file to a single-page PDF and return its size in bytes.
 *
 * ```ts
 * await mdToPDF("report.md", "report.pdf", { pageWidth: 1100 });
 * ```
 */
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
