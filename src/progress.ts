/**
 * Progress reporting shared by the conversion modules.
 *
 * Nothing under `src/` except the CLI writes to the console: the pipeline
 * emits these events and the caller decides how (or whether) to render them.
 */
export type ProgressEvent =
  | { kind: "parsed"; diagrams: number }
  | { kind: "diagram"; index: number; total: number; error?: string }
  | { kind: "rendered" }
  | { kind: "printing" }
  | { kind: "printed"; bytes: number };

export type ProgressListener = (event: ProgressEvent) => void;
