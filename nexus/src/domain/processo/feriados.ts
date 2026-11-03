/**
 * Calendário forense: quando o prazo processual corre e quando não corre.
 *
 * O QUE ESTE MÓDULO SABE E O QUE ELE NÃO SABE — e a distinção é a parte mais
 * importante dele, porque prazo perdido é dano ao cliente.
 *
 * SABE, e calcula sozinho:
 *   - feriados nacionais de data fixa;
 *   - os móveis, derivados da Páscoa (Sexta-feira Santa, Carnaval, Corpus
 *     Christi), por cálculo e não por tabela chumbada ano a ano;
 *   - fins de semana;
 *   - o recesso do art. 220 do CPC, de 20 de dezembro a 20 de janeiro.
 *
 * NÃO SABE, e por isso toda contagem sai com ressalva:
 *   - feriado estadual e municipal (a comarca de cada processo tem o seu);
 *   - suspensão decretada pelo tribunal (greve, mutirão, instabilidade do
 *     sistema, portaria de fim de ano além do recesso legal);
 *   - expediente encerrado mais cedo, que o art. 224, § 1º, equipara a dia
 *     sem expediente.
 *
 * Esses três só vêm do calendário de cada tribunal, e não há integração aqui.
 * Então o chamador pode INFORMÁ-LOS (`feriadosLocais`, `suspensoes`), e o que
 * sair daqui sem eles vem marcado como pendente de conferência. Um sistema que
 * cuspisse data de vencimento com ar de definitiva, sem o calendário da
 * comarca, seria pior do que não ter sistema: o advogado confiaria.
 */
import {
  type DataISO, comparar, ehFimDeSemana, formatar, partes, somarDias,
} from '../shared/datas.ts';

export type MotivoDeSuspensao =
  | 'fim_de_semana'
  | 'feriado_nacional'
  | 'suspensao_forense'
  | 'recesso_forense'
  | 'feriado_local'
  | 'suspensao_informada';

export interface DiaNaoUtil {
  readonly data: DataISO;
  readonly motivo: MotivoDeSuspensao;
  readonly nome: string;
}

/**
 * Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário
 * gregoriano). Dele saem os três feriados móveis que o Judiciário observa.
 */
export function pascoa(ano: number): DataISO {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const bruto = h + l - 7 * m + 114;
  return formatar(ano, Math.floor(bruto / 31), (bruto % 31) + 1);
}

interface FeriadoFixo { readonly mes: number; readonly dia: number; readonly nome: string }

/**
 * Feriados nacionais de data fixa.
 *
 * 20 de novembro entrou na lista por lei federal de 2023; antes disso era
 * estadual ou municipal, o que importa ao recalcular prazo de processo antigo.
 */
const FIXOS: readonly FeriadoFixo[] = Object.freeze([
  { mes: 1, dia: 1, nome: 'Confraternização Universal' },
  { mes: 4, dia: 21, nome: 'Tiradentes' },
  { mes: 5, dia: 1, nome: 'Dia do Trabalho' },
  { mes: 9, dia: 7, nome: 'Independência' },
  { mes: 10, dia: 12, nome: 'Nossa Senhora Aparecida' },
  { mes: 11, dia: 2, nome: 'Finados' },
  { mes: 11, dia: 15, nome: 'Proclamação da República' },
  { mes: 12, dia: 25, nome: 'Natal' },
]);

const ANO_DA_CONSCIENCIA_NEGRA = 2024;

/** Feriados e suspensões nacionais de um ano, já com os móveis calculados. */
export function calendarioNacional(ano: number): DiaNaoUtil[] {
  const dias: DiaNaoUtil[] = FIXOS.map((f) => ({
    data: formatar(ano, f.mes, f.dia),
    motivo: 'feriado_nacional' as const,
    nome: f.nome,
  }));

  if (ano >= ANO_DA_CONSCIENCIA_NEGRA) {
    dias.push({
      data: formatar(ano, 11, 20),
      motivo: 'feriado_nacional',
      nome: 'Dia Nacional de Zumbi e da Consciência Negra',
    });
  }

  const domingoDePascoa = pascoa(ano);
  // Carnaval e Corpus Christi não são feriado civil nacional; são dias de
  // suspensão do expediente forense, e para contagem de prazo dá no mesmo.
  // A distinção fica no motivo, porque é ela que o advogado confere.
  dias.push(
    { data: somarDias(domingoDePascoa, -48), motivo: 'suspensao_forense', nome: 'Carnaval (segunda)' },
    { data: somarDias(domingoDePascoa, -47), motivo: 'suspensao_forense', nome: 'Carnaval (terça)' },
    { data: somarDias(domingoDePascoa, -2), motivo: 'feriado_nacional', nome: 'Sexta-feira Santa' },
    { data: somarDias(domingoDePascoa, 60), motivo: 'suspensao_forense', nome: 'Corpus Christi' },
  );

  dias.sort((a, b) => comparar(a.data, b.data));
  return dias;
}

/**
 * Recesso do art. 220 do CPC: de 20 de dezembro a 20 de janeiro, inclusive,
 * o prazo processual não corre.
 */
export function noRecesso(data: DataISO): boolean {
  const { mes, dia } = partes(data);
  return (mes === 12 && dia >= 20) || (mes === 1 && dia <= 20);
}

export interface Calendario {
  /** Feriados da comarca, que só o tribunal conhece. */
  readonly feriadosLocais?: readonly DataISO[];
  /** Períodos suspensos por decisão do juízo ou portaria do tribunal. */
  readonly suspensoes?: readonly { readonly de: DataISO; readonly ate: DataISO; readonly motivo: string }[];
  /** Falso para prazo que corre no recesso (prazo material, não processual). */
  readonly considerarRecesso?: boolean;
}

/** Por que este dia não conta, ou `null` se contar. */
export function porQueNaoCorre(data: DataISO, calendario: Calendario = {}): DiaNaoUtil | null {
  if (ehFimDeSemana(data)) {
    return { data, motivo: 'fim_de_semana', nome: 'fim de semana' };
  }

  const { ano } = partes(data);
  const nacional = calendarioNacional(ano).find((f) => f.data === data);
  if (nacional) return nacional;

  if ((calendario.considerarRecesso ?? true) && noRecesso(data)) {
    return { data, motivo: 'recesso_forense', nome: 'recesso forense (art. 220 do CPC)' };
  }

  if (calendario.feriadosLocais?.includes(data)) {
    return { data, motivo: 'feriado_local', nome: 'feriado informado pelo calendário local' };
  }

  const suspensao = calendario.suspensoes?.find(
    (s) => comparar(data, s.de) >= 0 && comparar(data, s.ate) <= 0);
  if (suspensao) {
    return { data, motivo: 'suspensao_informada', nome: suspensao.motivo };
  }

  return null;
}

export function ehDiaUtilForense(data: DataISO, calendario: Calendario = {}): boolean {
  return porQueNaoCorre(data, calendario) === null;
}

/** Limite de busca, para que data absurda falhe em vez de girar para sempre. */
const MAXIMO_DE_PULOS = 400;

/** O próximo dia em que há expediente, a partir de `data` inclusive. */
export function proximoDiaUtil(data: DataISO, calendario: Calendario = {}): DataISO {
  let atual = data;
  for (let i = 0; i <= MAXIMO_DE_PULOS; i++) {
    if (ehDiaUtilForense(atual, calendario)) return atual;
    atual = somarDias(atual, 1);
  }
  throw new Error(
    `não há dia útil nos ${MAXIMO_DE_PULOS} dias seguintes a ${data}: ` +
    'o calendário informado provavelmente suspende um período longo demais');
}
