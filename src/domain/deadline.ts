import type { DeadlineCalc, Unit } from './types.ts';

/**
 * Cálculo de prazos processuais civis (CPC arts. 219, 220, 224).
 * - Disponibilização no DJe em D; publicação = 1º dia útil seguinte (art. 224 §2º-3º).
 * - Prazo começa a correr no 1º dia útil após a publicação (exclui o dia do começo).
 * - Dias úteis (art. 219) ou corridos; suspensão de 20/12 a 20/01 (art. 220).
 * - Dias úteis: vencimento sempre em dia útil. Dias corridos: vencimento em dia não útil é ANTECIPADO para o dia útil anterior (regra do escritório).
 * Feriados forenses locais NÃO são conhecidos: devem ser fornecidos via `holidays`.
 * Sem eles, o chamador deve sinalizar que o cálculo precisa de conferência humana.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function inRecess(d: Date): boolean {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return (m === 12 && day >= 20) || (m === 1 && day <= 20);
}

export function isBusinessDay(d: Date, holidays: ReadonlySet<string>): boolean {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !holidays.has(iso(d)) && !inRecess(d);
}

export function prevBusinessDay(d: Date, holidays: ReadonlySet<string>): Date {
  let c = addDays(d, -1);
  while (!isBusinessDay(c, holidays)) c = addDays(c, -1);
  return c;
}

export function nextBusinessDay(d: Date, holidays: ReadonlySet<string>): Date {
  let c = addDays(d, 1);
  while (!isBusinessDay(c, holidays)) c = addDays(c, 1);
  return c;
}

export interface DeadlineInput {
  availabilityDate: string;
  amount: number;
  unit: Unit;
  holidays?: ReadonlySet<string>;
}

export function computeDeadline({ availabilityDate, amount, unit, holidays = new Set() }: DeadlineInput): DeadlineCalc {
  const avail = parse(availabilityDate);
  const publication = nextBusinessDay(avail, holidays);
  const start = nextBusinessDay(publication, holidays);
  const common = `Disponibilização ${availabilityDate}; publicação ${iso(publication)} (1º dia útil seguinte); início da contagem ${iso(start)} (CPC art. 224 §§2º-3º).`;

  if (unit === 'horas' || unit === 'meses' || unit === 'anos') {
    return { amount, unit, startTerm: iso(start), endTerm: null, basis: `${common} Unidade "${unit}" não calculada automaticamente.` };
  }
  let cursor = start;
  let anticipated = false;
  if (unit === 'dias_uteis') {
    let counted = 1; // o 1º dia útil (start) é o dia 1
    while (counted < amount) {
      cursor = nextBusinessDay(cursor, holidays);
      counted++;
    }
  } else {
    // dias corridos: conta cada dia fora do recesso; start é o dia 1
    let counted = 1;
    while (counted < amount) {
      cursor = addDays(cursor, 1);
      if (!inRecess(cursor)) counted++;
    }
    // Regra do escritório (dias corridos): vencimento em dia não útil é ANTECIPADO para o dia útil anterior (nunca prorrogado).
    if (!isBusinessDay(cursor, holidays)) { cursor = prevBusinessDay(cursor, holidays); anticipated = true; }
  }
  const art = unit === 'dias_uteis' ? 'art. 219 (dias úteis)' : anticipated ? 'dias corridos; vencimento em dia não útil ANTECIPADO para o dia útil anterior (regra do escritório)' : 'dias corridos';
  return {
    amount,
    unit,
    startTerm: iso(start),
    endTerm: iso(cursor),
    basis: `${common} ${amount} ${unit === 'dias_uteis' ? 'dias úteis' : 'dias corridos'} — CPC ${art}; recesso 20/12–20/01 excluído (art. 220).`,
  };
}
