/**
 * Library entry point.
 *
 * ```ts
 * import { mdToPDF } from "./mod.ts";
 *
 * await mdToPDF("report.md", "report.pdf", {
 *   pageWidth: 1100,
 *   onProgress: (event) => console.log(event.kind),
 * });
 * ```
 */
export {
  type ConvertOptions,
  DEFAULT_PAGE_WIDTH_PX,
  mdToPDF,
} from "./src/convert.ts";
export type { ProgressEvent, ProgressListener } from "./src/progress.ts";
export { buildDocument, markdownToHtml } from "./src/markdown.ts";
export { plantumlToSvg } from "./src/plantuml.ts";
export { htmlToPdf } from "./src/pdf.ts";
