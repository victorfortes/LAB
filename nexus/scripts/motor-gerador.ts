/**
 * Traz o MOTOR do Gerador de Relatórios para dentro do LAB, sem reescrever nada.
 *
 * O Gerador (pasta `relatorios/`, mesmo código de relatoriosnga.lovable.app) é um HTML único: leitor do PDF do
 * Astrea, núcleo de classificação/indicadores e o desenho do PDF em jsPDF. Este script lê o `gerador.html` já com
 * os patches P1–P53, recorta exatamente essas quatro partes (mais o jsPDF e o logotipo oficial), aplica os
 * patches do LAB (`motor-gerador.patches.json`, cada um precisa casar exatamente uma vez) e escreve um módulo
 * ES isolado: `criarMotor()` devolve uma instância com `window` próprio, sem tocar o global do servidor.
 *
 *   bun scripts/motor-gerador.ts             # regenera src/relatorio/motor_gerador.gen.js
 *   bun scripts/motor-gerador.ts --conferir  # falha se o módulo não corresponde ao gerador.html atual
 *
 * Mudou o Gerador (novo patch P54...)? Rode o script e confira os testes: o LAB passa a gerar o mesmo PDF.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dir, '..');
const ORIGEM = join(RAIZ, '..', 'relatorios', 'public', 'gerador', 'app', 'gerador.html');
const DESTINO = join(RAIZ, 'src', 'relatorio', 'motor_gerador.gen.js');
const PATCHES = join(import.meta.dir, 'motor-gerador.patches.json');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function montarMotor(html: string, patches: { id: string; parte: string; de: string; para: string }[]) {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1]!, corpo: m[2]! }));
  const achar = (nome: string, teste: (s: { attrs: string; corpo: string }) => boolean) => {
    const achados = scripts.filter(teste);
    if (achados.length !== 1) throw new Error(`gerador.html: parte "${nome}" encontrada ${achados.length} vez(es); esperado 1`);
    return achados[0]!.corpo;
  };
  const partes: Record<string, string> = {
    jspdf: achar('jspdf', (s) => s.corpo.includes('jsPDF - PDF Document creation from JavaScript')),
    logo: achar('logo', (s) => /id="nga-logo-b64"/.test(s.attrs)).trim(),
    leitor: achar('leitor', (s) => s.corpo.trimStart().startsWith('const PROCESS_COLUMNS')),
    nucleo: achar('nucleo', (s) => s.corpo.includes('nucleo.js  ·  motor de leitura e classificacao')),
    pdf: achar('pdf', (s) => s.corpo.trimStart().startsWith('// Port of relatorio_pdf/gerador.py')),
  };
  if (!/^[A-Za-z0-9+/=\s]+$/.test(partes.logo!)) throw new Error('gerador.html: logotipo não é base64');
  for (const p of patches) {
    const alvo = partes[p.parte];
    if (alvo === undefined) throw new Error(`patch ${p.id}: parte desconhecida ${p.parte}`);
    const vezes = alvo.split(p.de).length - 1;
    if (vezes !== 1) throw new Error(`patch ${p.id}: casou ${vezes} vez(es) em ${p.parte}; esperado 1`);
    partes[p.parte] = alvo.replace(p.de, () => p.para);
  }
  const origemSha = sha(html);
  // jsPDF e desenho do PDF ficam em escopos próprios; núcleo e leitor dividem um (como na página). Nomes de topo não colidem e
  // nada vaza para o global do servidor (`window`, `self` e `globalThis` são sombreados pelo objeto da instância).
  return `// GERADO por scripts/motor-gerador.ts a partir de relatorios/public/gerador/app/gerador.html. NÃO EDITAR.
// Origem sha256 ${origemSha} · patches do LAB: ${patches.map((p) => p.id).join(', ') || 'nenhum'}
/* eslint-disable */
export const ORIGEM_SHA256 = ${JSON.stringify(origemSha)};
export const PATCHES_LAB = ${JSON.stringify(patches.map((p) => p.id))};
const LOGO = ${JSON.stringify('data:image/png;base64,' + partes.logo!.replace(/\s+/g, ''))};
const GLOBAL_REAL = globalThis;

export function criarMotor() {
  // Lê do global real (atob, TextEncoder, Intl...), mas o que o motor grava fica só nesta instância.
  const window = Object.assign(Object.create(GLOBAL_REAL), { NGA_LOGO_DATA_URL: LOGO });
  const self = window, globalThis = window, exports = undefined, module = undefined, define = undefined;
  (function () {
${partes.jspdf}
  }).call(window);
  // Núcleo e leitor dividem o escopo, como dividem o global na página original (a auditoria usa funções do núcleo).
  const nucleo = (function () {
${partes.nucleo}
${partes.leitor}
    return { calcularIndicadores, dataBR, valorBRL, NUCLEO, QUALIDADE, parseAstreaPDF, auditarGeracao };
  })();
  const pdf = (function (valorBRL) {
    const NGA_LOGO_DATA_URL = LOGO;
${partes.pdf}
    return { GeradorRelatorioPDF, nomeCurto };
  })(nucleo.valorBRL);
  return { window, ...nucleo, ...pdf };
}
`;
}

if (import.meta.main) {
  if (!existsSync(ORIGEM)) { console.error(`não achei ${ORIGEM}`); process.exit(1); }
  const novo = montarMotor(readFileSync(ORIGEM, 'utf8'), JSON.parse(readFileSync(PATCHES, 'utf8')));
  if (process.argv.includes('--conferir')) {
    const atual = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8') : '';
    if (atual !== novo) { console.error('motor_gerador.gen.js desatualizado: rode bun scripts/motor-gerador.ts'); process.exit(1); }
    console.log('motor do Gerador em dia');
  } else {
    writeFileSync(DESTINO, novo);
    console.log(`escrito ${DESTINO} (${(novo.length / 1024).toFixed(0)} KB)`);
  }
}
