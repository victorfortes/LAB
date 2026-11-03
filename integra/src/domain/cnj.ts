// Numeração única CNJ (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO

export interface Cnj {
  formatted: string;
  digits: string;
  sequential: string;
  check: string;
  year: string;
  segment: string; // J
  tribunal: string; // TR
  origin: string; // OOOO
  checkOk: boolean;
}

export function parseCnj(input: string): Cnj | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 20) return null;
  const sequential = digits.slice(0, 7);
  const check = digits.slice(7, 9);
  const year = digits.slice(9, 13);
  const segment = digits.slice(13, 14);
  const tribunal = digits.slice(14, 16);
  const origin = digits.slice(16, 20);
  // DD = 98 − ((NNNNNNN AAAA J TR OOOO 00) mod 97)
  const body = sequential + year + segment + tribunal + origin + "00";
  let rem = 0;
  for (const ch of body) rem = (rem * 10 + Number(ch)) % 97;
  const checkOk = String(98 - rem).padStart(2, "0") === check;
  return {
    formatted: `${sequential}-${check}.${year}.${segment}.${tribunal}.${origin}`,
    digits, sequential, check, year, segment, tribunal, origin, checkOk,
  };
}
