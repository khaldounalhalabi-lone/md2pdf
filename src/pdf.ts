// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { launch } from "jsr:@astral/astral@^0.5.6";

const PX_PER_INCH = 96; // CSS reference pixel density used by Chrome's PDF engine

/**
 * Print HTML to a PDF sized exactly to its content, so the whole document
 * lands on a single page. Uses whatever Chrome/Chromium Astral can find,
 * downloading a headless build on first use if there is none.
 */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
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
