# Sample document

This file exercises everything `md2pdf` handles: GitHub-flavored Markdown plus
`plantuml` fences that are rendered server-side and inlined as SVG.

## A sequence diagram

```plantuml
@startuml
actor User
participant "md2pdf" as CLI
participant "plantuml.com" as Server
participant "headless Chrome" as Chrome

User -> CLI: md2pdf sample.md
CLI -> Server: encoded diagram source
Server --> CLI: SVG
CLI -> Chrome: HTML with inline SVG
Chrome --> CLI: PDF (one tall page)
CLI --> User: sample.pdf
@enduml
```

## Ordinary Markdown

Tables, code and lists all render through `@deno/gfm`:

| Option       | Default | Notes                        |
| ------------ | ------- | ---------------------------- |
| `--width`    | 900     | Content column width, in px  |
| `--override` | off     | Overwrite an existing output |

```ts
import { mdToPDF } from "../mod.ts";

await mdToPDF("examples/sample.md", "sample.pdf");
```

- [x] Diagrams fetched in parallel
- [x] One page, no breaks
- [ ] Your document here

> A diagram that fails to render is left in the PDF as plain text, and reported
> at the end of the run.
