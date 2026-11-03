/**
 * Folha A4: o pouco de tipografia que um relatório jurídico precisa.
 *
 * SOBRE A IDENTIDADE VISUAL. O sistema de design do NGA Lab é fundo azul
 * quase preto com âmbar; isso é para tela. Relatório vai para papel e para
 * anexo de e-mail, e fundo escuro no papel é mancha de toner e texto que o
 * juiz não lê. A adaptação é deliberada: fundo branco, texto no mesmo
 * azul-quase-preto da marca, âmbar nos fios e nos rótulos. A linguagem visual
 * continua a mesma; o suporte é que mudou.
 *
 * SOBRE AS FONTES. Barlow e JetBrains Mono não estão no repositório, e
 * embutir fonte exige o arquivo. Então Helvetica onde seria Barlow e Courier
 * onde seria JetBrains Mono — as duas padrão do PDF, que não dependem de nada
 * instalado em lugar nenhum. É substituição declarada, não disfarce.
 */
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { encurtar, paraWinAnsi, quebrarLinhas } from './texto.ts';

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { esquerda: 50, direita: 50, topo: 56, base: 58 };

const COR = {
  tinta: rgb(0.043, 0.067, 0.094),      // #0B1118 — o azul quase preto da marca
  tintaFraca: rgb(0.36, 0.42, 0.49),
  ambar: rgb(0.94, 0.64, 0.18),         // #F0A32E
  ambarEscuro: rgb(0.60, 0.38, 0.05),   // legível como texto sobre branco
  risco: rgb(0.70, 0.16, 0.16),
  fio: rgb(0.85, 0.87, 0.89),
  fundoCabecalho: rgb(0.96, 0.97, 0.98),
};

export interface Coluna {
  readonly titulo: string;
  readonly largura: number;
  readonly alinhamento?: 'esquerda' | 'direita';
  /** Dado técnico: valor, data, CNPJ. Sai em monoespaçada. */
  readonly tecnico?: boolean;
}

export class Folha {
  readonly #doc: PDFDocument;
  readonly #regular: PDFFont;
  readonly #negrito: PDFFont;
  readonly #mono: PDFFont;
  readonly #paginas: PDFPage[] = [];
  #pagina!: PDFPage;
  #y = 0;

  readonly larguraUtil = A4.largura - MARGEM.esquerda - MARGEM.direita;

  private constructor(doc: PDFDocument, regular: PDFFont, negrito: PDFFont, mono: PDFFont) {
    this.#doc = doc;
    this.#regular = regular;
    this.#negrito = negrito;
    this.#mono = mono;
    this.novaPagina();
  }

  static async criar(): Promise<Folha> {
    const doc = await PDFDocument.create();
    return new Folha(
      doc,
      await doc.embedFont(StandardFonts.Helvetica),
      await doc.embedFont(StandardFonts.HelveticaBold),
      await doc.embedFont(StandardFonts.Courier),
    );
  }

  get totalDePaginas(): number { return this.#paginas.length; }
  /** Espaço vertical que ainda cabe na página corrente. */
  get espacoRestante(): number { return this.#y - MARGEM.base; }

  novaPagina(): void {
    this.#pagina = this.#doc.addPage([A4.largura, A4.altura]);
    this.#paginas.push(this.#pagina);
    this.#y = A4.altura - MARGEM.topo;
  }

  /** Abre página nova se o bloco não couber inteiro — evita órfã e viúva. */
  #garantir(altura: number): void {
    if (this.espacoRestante < altura) this.novaPagina();
  }

  espaco(pontos: number): void {
    this.#y -= pontos;
    if (this.espacoRestante < 0) this.novaPagina();
  }

  regua(cor = COR.fio, espessura = 0.75): void {
    this.#garantir(10);
    this.#pagina.drawLine({
      start: { x: MARGEM.esquerda, y: this.#y },
      end: { x: A4.largura - MARGEM.direita, y: this.#y },
      thickness: espessura,
      color: cor,
    });
    this.#y -= 10;
  }

  // ------------------------------------------------------------- textos ---

  titulo(texto: string): void {
    this.#garantir(42);
    this.#escrever(paraWinAnsi(texto), this.#negrito, 18, COR.tinta);
    this.#y -= 4;
    this.#pagina.drawLine({
      start: { x: MARGEM.esquerda, y: this.#y },
      end: { x: MARGEM.esquerda + 46, y: this.#y },
      thickness: 2.5,
      color: COR.ambar,
    });
    this.#y -= 16;
  }

  secao(texto: string): void {
    // 34 = título + fio + ao menos uma linha de conteúdo logo abaixo.
    this.#garantir(34);
    this.espaco(6);
    this.#escrever(paraWinAnsi(texto).toUpperCase(), this.#negrito, 10.5, COR.ambarEscuro, 1.2);
    this.#y -= 2;
    this.regua();
  }

  paragrafo(texto: string, opcoes: { tamanho?: number; cor?: typeof COR.tinta } = {}): void {
    const tamanho = opcoes.tamanho ?? 10;
    const linhas = quebrarLinhas(texto, this.#regular, tamanho, this.larguraUtil);
    for (const linha of linhas) {
      this.#garantir(tamanho * 1.45);
      this.#escrever(linha, this.#regular, tamanho, opcoes.cor ?? COR.tinta, 1.45);
    }
    this.#y -= 4;
  }

  /** Par rótulo/valor, como "Processo  0001234-56.2024.8.16.0001". */
  campo(rotulo: string, valor: string): void {
    this.#garantir(16);
    const larguraRotulo = 132;
    this.#pagina.drawText(paraWinAnsi(rotulo), {
      x: MARGEM.esquerda, y: this.#y, size: 8.5, font: this.#negrito, color: COR.tintaFraca,
    });
    const linhas = quebrarLinhas(
      valor, this.#regular, 10, this.larguraUtil - larguraRotulo);
    let primeiro = true;
    for (const linha of linhas) {
      if (!primeiro) { this.#garantir(14); this.#y -= 13; }
      this.#pagina.drawText(linha, {
        x: MARGEM.esquerda + larguraRotulo, y: this.#y, size: 10,
        font: this.#regular, color: COR.tinta,
      });
      primeiro = false;
    }
    this.#y -= 16;
  }

  /**
   * Ressalva. Fio âmbar à esquerda, para o leitor não passar direto: é aqui
   * que mora o que o relatório NÃO afirma.
   */
  nota(texto: string): void {
    const tamanho = 8.5;
    const recuo = 10;
    const linhas = quebrarLinhas(texto, this.#regular, tamanho, this.larguraUtil - recuo);
    this.#garantir(linhas.length * tamanho * 1.4 + 8);
    const topo = this.#y + 8;
    for (const linha of linhas) {
      this.#pagina.drawText(linha, {
        x: MARGEM.esquerda + recuo, y: this.#y, size: tamanho,
        font: this.#regular, color: COR.tintaFraca,
      });
      this.#y -= tamanho * 1.4;
    }
    this.#pagina.drawLine({
      start: { x: MARGEM.esquerda, y: topo },
      end: { x: MARGEM.esquerda, y: this.#y + tamanho },
      thickness: 1.5, color: COR.ambar,
    });
    this.#y -= 6;
  }

  /**
   * Ausência de dado. É o §15 em forma de componente: seção sem dado diz que
   * não tem, em vez de mostrar zero como se fosse medição.
   */
  semDados(motivo: string): void {
    // Quebra em linhas como qualquer texto: a primeira versão escrevia numa
    // linha só e a frase saía por fora da margem direita — justamente a
    // frase que o leitor precisa ler inteira.
    const tamanho = 9.5;
    for (const linha of quebrarLinhas(motivo, this.#regular, tamanho, this.larguraUtil)) {
      this.#garantir(tamanho * 1.5);
      this.#escrever(linha, this.#regular, tamanho, COR.risco, 1.5);
    }
    this.#y -= 4;
  }

  // ------------------------------------------------------------ tabelas ---

  tabela(colunas: readonly Coluna[], linhas: readonly (readonly string[])[]): void {
    if (colunas.length === 0) throw new Error('tabela sem colunas');
    const alturaLinha = 16;
    const desenharCabecalho = (): void => {
      this.#pagina.drawRectangle({
        x: MARGEM.esquerda, y: this.#y - 4, width: this.larguraUtil, height: alturaLinha,
        color: COR.fundoCabecalho,
      });
      let x = MARGEM.esquerda + 5;
      for (const coluna of colunas) {
        this.#pagina.drawText(encurtar(coluna.titulo.toUpperCase(), this.#negrito, 7.5, coluna.largura - 10), {
          x, y: this.#y, size: 7.5, font: this.#negrito, color: COR.tintaFraca,
        });
        x += coluna.largura;
      }
      this.#y -= alturaLinha + 2;
    };

    this.#garantir(alturaLinha * 3);
    desenharCabecalho();

    for (const linha of linhas) {
      if (this.espacoRestante < alturaLinha + 4) {
        this.novaPagina();
        // Cabeçalho repetido na página nova: tabela que vira a folha sem
        // repetir o cabeçalho obriga o leitor a voltar.
        desenharCabecalho();
      }
      let x = MARGEM.esquerda + 5;
      for (let i = 0; i < colunas.length; i++) {
        const coluna = colunas[i]!;
        const fonte = coluna.tecnico ? this.#mono : this.#regular;
        const tamanho = coluna.tecnico ? 8 : 9;
        const conteudo = encurtar(linha[i] ?? '', fonte, tamanho, coluna.largura - 10);
        const largura = fonte.widthOfTextAtSize(conteudo, tamanho);
        this.#pagina.drawText(conteudo, {
          x: coluna.alinhamento === 'direita' ? x + coluna.largura - 10 - largura : x,
          y: this.#y, size: tamanho, font: fonte, color: COR.tinta,
        });
        x += coluna.largura;
      }
      this.#y -= alturaLinha;
      this.#pagina.drawLine({
        start: { x: MARGEM.esquerda, y: this.#y + 10 },
        end: { x: A4.largura - MARGEM.direita, y: this.#y + 10 },
        thickness: 0.4, color: COR.fio,
      });
    }
    this.#y -= 6;
  }

  // ------------------------------------------------------------- rodapé ---

  /**
   * Rodapé em todas as páginas, no fim — só aqui se sabe o total.
   *
   * Leva sempre o aviso de que o relatório é gerado: quem recebe o PDF solto,
   * sem o portal em volta, precisa saber de onde veio e quando.
   */
  rodape(linhaEsquerda: string, linhaDireita: string): void {
    const total = this.#paginas.length;
    this.#paginas.forEach((pagina, i) => {
      const y = MARGEM.base - 22;
      pagina.drawLine({
        start: { x: MARGEM.esquerda, y: y + 14 },
        end: { x: A4.largura - MARGEM.direita, y: y + 14 },
        thickness: 0.5, color: COR.fio,
      });
      pagina.drawText(encurtar(linhaEsquerda, this.#regular, 7.5, this.larguraUtil - 180), {
        x: MARGEM.esquerda, y, size: 7.5, font: this.#regular, color: COR.tintaFraca,
      });
      const direita = `${paraWinAnsi(linhaDireita)}  |  ${i + 1} de ${total}`;
      pagina.drawText(direita, {
        x: A4.largura - MARGEM.direita - this.#regular.widthOfTextAtSize(direita, 7.5),
        y, size: 7.5, font: this.#regular, color: COR.tintaFraca,
      });
    });
  }

  /** Marca de topo da primeira página. */
  marca(subtitulo: string): void {
    const pagina = this.#paginas[0]!;
    const y = A4.altura - 32;
    pagina.drawText('NGA', {
      x: MARGEM.esquerda, y, size: 11, font: this.#negrito, color: COR.tinta,
    });
    pagina.drawText('LAB', {
      x: MARGEM.esquerda + this.#negrito.widthOfTextAtSize('NGA ', 11),
      y, size: 11, font: this.#negrito, color: COR.ambarEscuro,
    });
    const texto = paraWinAnsi(subtitulo);
    pagina.drawText(texto, {
      x: A4.largura - MARGEM.direita - this.#regular.widthOfTextAtSize(texto, 8.5),
      y, size: 8.5, font: this.#regular, color: COR.tintaFraca,
    });
  }

  async salvar(): Promise<Uint8Array> {
    return this.#doc.save();
  }

  #escrever(texto: string, fonte: PDFFont, tamanho: number, cor: typeof COR.tinta, fator = 1.4): void {
    this.#pagina.drawText(texto, {
      x: MARGEM.esquerda, y: this.#y, size: tamanho, font: fonte, color: cor,
    });
    this.#y -= tamanho * fator;
  }
}
