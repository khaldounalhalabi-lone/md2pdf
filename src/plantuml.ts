// Fully-qualified specifiers (rather than an import map in deno.json) so this
// module also resolves when it is fetched over HTTP by a remote install.
import { deflateSync } from "npm:fflate@^0.8.2";

const PLANTUML_SERVER = "https://www.plantuml.com/plantuml/svg";

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

/** Render one diagram through the public PlantUML server, as inline-able SVG. */
export async function plantumlToSvg(source: string): Promise<string> {
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
