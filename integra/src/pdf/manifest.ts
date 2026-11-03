import type { SplitResult } from "./split.ts";

export interface ManifestInput {
  caseName: string;
  cnj: string;
  side: string;
  maxBytes: number;
  capture: string;
  split: SplitResult;
}

export function buildManifest(i: ManifestInput) {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    caseName: i.caseName,
    cnj: i.cnj,
    side: i.side,
    maxBytes: i.maxBytes,
    ocr: "nao_executado",
    eventIndex: "nao_identificado",
    capture: i.capture,
    sources: i.split.sources,
    parts: i.split.parts,
  };
}

export type Manifest = ReturnType<typeof buildManifest>;
