import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { NotMappedError } from './port.ts';

const Entry = z.object({
  selector: z.string().min(1),
  /** Referência obrigatória ao passo de reconhecimento que comprova o seletor. */
  evidence: z.string().min(1),
  confirmedAt: z.string().min(1),
});
const Schema = z.object({
  version: z.number(),
  confirmedAgainstRecon: z.string().nullable(),
  read: z.record(z.string(), Entry),
  write: z.record(z.string(), Entry),
});
export type SelectorMap = z.infer<typeof Schema>;

export function loadSelectors(path: string): SelectorMap {
  return Schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function requireSelector(map: SelectorMap, group: 'read' | 'write', name: string): string {
  const e = map[group][name];
  if (!e) throw new NotMappedError(`seletor ${group}.${name}`);
  return e.selector;
}
