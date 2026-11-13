/**
 * Modelo de relatório, e o §15 em forma de tipo.
 *
 * "Não gerar relatórios com dados fictícios ou indicadores preenchidos apenas
 * para demonstrar a interface."
 *
 * A forma de cumprir isso não é disciplina de quem escreve o relatório — é
 * não deixar o contrário ser exprimível. Por isso `tabela()` EXIGE o campo
 * `seVazio`: não existe como acrescentar uma tabela sem dizer o que o leitor
 * lê quando não houver dado. Tabela vazia nunca sai como tabela vazia; sai
 * como frase dizendo por que está vazia, e a falta entra na lista de lacunas
 * impressa no fim.
 *
 * E todo relatório termina com duas seções que normalmente ninguém põe:
 * PROCEDÊNCIA DOS DADOS, dizendo de onde saiu cada número, e O QUE ESTE
 * RELATÓRIO NÃO AFIRMA, com as lacunas. Um PDF circula solto, sem o sistema
 * em volta; quem o recebe precisa saber o que ele mede e o que ele não mede.
 */
import { type Coluna, Folha } from './folha.ts';

export type Bloco =
  | { readonly tipo: 'secao'; readonly titulo: string }
  | { readonly tipo: 'paragrafo'; readonly texto: string }
  | { readonly tipo: 'campo'; readonly rotulo: string; readonly valor: string }
  | { readonly tipo: 'tabela'; readonly colunas: readonly Coluna[]; readonly linhas: readonly (readonly string[])[] }
  | { readonly tipo: 'nota'; readonly texto: string }
  | { readonly tipo: 'ausente'; readonly motivo: string }
  | { readonly tipo: 'espaco'; readonly pontos: number }
  | { readonly tipo: 'regua' };

export interface Relatorio {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly blocos: readonly Bloco[];
  /** De onde saiu cada número. Rastreabilidade é requisito, não enfeite. */
  readonly fontes: readonly string[];
  /** O que o relatório não pôde afirmar, e por quê. */
  readonly lacunas: readonly string[];
  readonly geradoEm: string;
  readonly geradoPor: string;
}

export interface PedidoDeTabela {
  readonly colunas: readonly Coluna[];
  readonly linhas: readonly (readonly string[])[];
  /**
   * O que o leitor lê quando não há linha alguma. Obrigatório: é a diferença
   * entre "zero" e "não medimos isto".
   */
  readonly seVazio: string;
  /** Tabela em que a origem do dado merece registro. */
  readonly fonte?: string;
}

export class Construtor {
  readonly #blocos: Bloco[] = [];
  readonly #fontes = new Set<string>();
  readonly #lacunas: string[] = [];

  secao(titulo: string): this {
    this.#blocos.push({ tipo: 'secao', titulo });
    return this;
  }

  paragrafo(texto: string): this {
    this.#blocos.push({ tipo: 'paragrafo', texto });
    return this;
  }

  campo(rotulo: string, valor: string | null | undefined): this {
    // Campo sem valor sai como "não informado", nunca em branco: em branco o
    // leitor não sabe se é ausência de dado ou falha do relatório.
    this.#blocos.push({ tipo: 'campo', rotulo, valor: valor ?? 'não informado' });
    return this;
  }

  tabela(pedido: PedidoDeTabela): this {
    if (pedido.fonte) this.#fontes.add(pedido.fonte);
    if (pedido.linhas.length === 0) {
      this.#blocos.push({ tipo: 'ausente', motivo: pedido.seVazio });
      this.#lacunas.push(pedido.seVazio);
      return this;
    }
    this.#blocos.push({ tipo: 'tabela', colunas: pedido.colunas, linhas: pedido.linhas });
    return this;
  }

  nota(texto: string): this {
    this.#blocos.push({ tipo: 'nota', texto });
    return this;
  }

  espaco(pontos = 8): this {
    this.#blocos.push({ tipo: 'espaco', pontos });
    return this;
  }

  regua(): this {
    this.#blocos.push({ tipo: 'regua' });
    return this;
  }

  /** Registra a origem de um dado sem precisar de tabela. */
  fonte(texto: string): this {
    this.#fontes.add(texto);
    return this;
  }

  /** Declara algo que o relatório não afirma. */
  lacuna(texto: string): this {
    this.#lacunas.push(texto);
    return this;
  }

  montar(cabecalho: {
    titulo: string; subtitulo: string; geradoPor: string; geradoEm?: string;
  }): Relatorio {
    return {
      titulo: cabecalho.titulo,
      subtitulo: cabecalho.subtitulo,
      blocos: this.#blocos,
      fontes: [...this.#fontes],
      lacunas: this.#lacunas,
      geradoEm: cabecalho.geradoEm ?? new Date().toISOString(),
      geradoPor: cabecalho.geradoPor,
    };
  }
}

function dataHoraBR(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Desenha o relatório e devolve o PDF. */
export async function renderizar(relatorio: Relatorio): Promise<Uint8Array> {
  const folha = await Folha.criar();

  folha.marca(relatorio.subtitulo);
  folha.espaco(10);
  folha.titulo(relatorio.titulo);

  for (const bloco of relatorio.blocos) {
    switch (bloco.tipo) {
      case 'secao': folha.secao(bloco.titulo); break;
      case 'paragrafo': folha.paragrafo(bloco.texto); break;
      case 'campo': folha.campo(bloco.rotulo, bloco.valor); break;
      case 'tabela': folha.tabela(bloco.colunas, bloco.linhas); break;
      case 'nota': folha.nota(bloco.texto); break;
      case 'ausente': folha.semDados(bloco.motivo); break;
      case 'espaco': folha.espaco(bloco.pontos); break;
      case 'regua': folha.regua(); break;
    }
  }

  // --- as duas seções que fecham todo relatório ---
  folha.espaco(10);
  folha.secao('Procedência dos dados');
  if (relatorio.fontes.length === 0) {
    folha.semDados('Nenhuma fonte de dado foi declarada para este relatório.');
  } else {
    for (const f of relatorio.fontes) folha.paragrafo(`• ${f}`, { tamanho: 8.5 });
  }

  folha.espaco(6);
  folha.secao('O que este relatório não afirma');
  if (relatorio.lacunas.length === 0) {
    folha.paragrafo(
      'Todas as seções deste relatório foram preenchidas com dados registrados na plataforma.',
      { tamanho: 8.5 });
  } else {
    for (const l of relatorio.lacunas) folha.paragrafo(`• ${l}`, { tamanho: 8.5 });
  }
  folha.nota(
    'Documento gerado automaticamente a partir dos dados registrados na plataforma NGA LAB. ' +
    'Os números refletem o que estava lançado no momento da geração e não substituem ' +
    'a conferência nos autos e nos documentos de origem.');

  folha.rodape(
    `NGA LAB · gerado em ${dataHoraBR(relatorio.geradoEm)} por ${relatorio.geradoPor}`,
    relatorio.titulo);

  return folha.salvar();
}
