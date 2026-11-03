/**
 * Erros de pedido, distintos de falha do servidor.
 *
 * Antes disto, "documento não encontrado" virava 500 — e 500 é mentira: não
 * houve falha do servidor, houve pedido para uma linha que o usuário não
 * alcança. O §18 proíbe fluxo incompleto; devolver erro com o código errado é
 * exatamente isso, do ponto de vista de quem consome a API.
 *
 * Importante: `NaoEncontrado` cobre tanto "não existe" quanto "existe e o RLS
 * não te deixa ver", e isso é deliberado. Distinguir os dois casos contaria ao
 * cliente que o recurso existe, o que o §13 não quer que se conte.
 */

export class NaoEncontrado extends Error {
  override readonly name = 'NaoEncontrado';
  constructor(descricao: string) {
    super(descricao);
  }
}

/** O pedido é inteligível, mas falta um pré-requisito do fluxo. */
export class PedidoInvalido extends Error {
  override readonly name = 'PedidoInvalido';
  constructor(descricao: string) {
    super(descricao);
  }
}
