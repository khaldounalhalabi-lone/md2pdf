// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { type Browser, launch } from "jsr:@astral/astral@^0.5.6";
import type { ProgressListener } from "./progress.ts";

const PX_PER_INCH = 96; // CSS reference pixel density used by Chrome's PDF engine

/**
 * Start Chrome, retrying without its sandbox if it refuses to boot.
 *
 * Chrome's sandbox needs unprivileged user namespaces, which hardened kernels,
 * containers and recent Ubuntu AppArmor profiles often deny — the browser then
 * dies with "No usable sandbox!" before it ever speaks the DevTools protocol.
 * We only ever render HTML we generated ourselves, so dropping the sandbox to
 * get a PDF out is a reasonable trade; the caller is told it happened.
 */
async function launchBrowser(onProgress: ProgressListener): Promise<Browser> {
  // $MD2PDF_CHROME points at a specific browser; otherwise Astral finds or
  // downloads one.
  const path = Deno.env.get("MD2PDF_CHROME") || undefined;
  try {
    // Astral dumps the browser's stderr through console.error when it fails to
    // boot. That crash dump is expected here and we recover from it below, so
    // it is muted for the first attempt only — a failing retry stays loud.
    const consoleError = console.error;
    console.error = () => {};
    try {
      return await launch({ path });
    } finally {
      console.error = consoleError;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      const browser = await launch({ path, args: ["--no-sandbox"] });
      onProgress({
        kind: "notice",
        message: "Chrome would not start normally, so it was run with " +
          "--no-sandbox (its own sandbox is unavailable on this kernel).",
      });
      return browser;
    } catch {
      // Report the original failure: the retry's error is the same story twice.
      throw new Error(`Chrome could not be started — ${reason}`);
    }
  }
}

/**
 * Print HTML to a PDF sized exactly to its content, so the whole document
 * lands on a single page. Uses whatever Chrome/Chromium Astral can find,
 * downloading a headless build on first use if there is none.
 */
export async function htmlToPdf(
  html: string,
  onProgress: ProgressListener = () => {},
): Promise<Uint8Array> {
  const browser = await launchBrowser(onProgress);
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
