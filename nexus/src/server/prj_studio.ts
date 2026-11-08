import type { PoolClient } from 'pg';
import { z } from 'zod';
import { gerarCronograma, MESES_POR_PERIODO } from '../domain/insolvencia/plano.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';

export const EsquemaSimulacaoPrj = z.object({
  classe: z.enum(['I', 'II', 'III', 'IV']),
  dataBase: z.iso.date().refine((d) => d >= '1900-01-01' && d <= '2100-12-31'),
  desagio: z.number().min(0).lt(1),
  carenciaMeses: z.number().int().min(0).max(120),
  parcelas: z.number().int().min(1).max(360),
  periodicidade: z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
  jurosAoAno: z.number().min(0).max(1),
  regimeDeJuros: z.enum(['nominal', 'efetiva']).default('nominal'),
  sistema: z.enum(['sem_juros', 'sac', 'price']),
  capitalizarNaCarencia: z.boolean().default(false),
}).refine((d) => d.sistema !== 'sem_juros' || d.jurosAoAno === 0,
  'Informe juros zero para o sistema sem juros.')
  .refine((d) => d.carenciaMeses + d.parcelas * MESES_POR_PERIODO[d.periodicidade] <= 600,
    'Limite o cenário a 50 anos.');

export async function simularPrj(db: PoolClient, projetoId: string, dados: z.infer<typeof EsquemaSimulacaoPrj>) {
  const projeto = await db.query(
    'SELECT id FROM projetos WHERE id=$1 AND organizacao_id IN (SELECT app_organizacoes_visiveis())',
    [projetoId]);
  if (!projeto.rowCount) throw new NaoEncontrado('projeto não encontrado');

  const { classe, dataBase, ...condicao } = dados;
  const { rows } = await db.query<{ valor: string; classe_validada: string | null; sujeito_validado: boolean | null }>(
    'SELECT valor, classe_validada, sujeito_validado FROM creditos WHERE projeto_id=$1',
    [projetoId]);
  const creditos = rows.filter((c) => c.classe_validada === classe && c.sujeito_validado === true);
  if (creditos.length * condicao.parcelas > 100_000) {
    throw new PedidoInvalido('Este cenário excede 100 mil parcelas. Reduza o número de parcelas para simular.');
  }

  // Calcula por crédito e soma por vencimento, preservando o arredondamento de cada credor.
  const porVencimento = new Map<string, { vencimento: string; amortizacao: bigint; juros: bigint; valor: bigint; saldo: bigint }>();
  const totais = { original: 0n, novado: 0n, desagio: 0n, juros: 0n, total: 0n };
  for (const credito of creditos) {
    const cronograma = gerarCronograma(BigInt(credito.valor), condicao, dataBase);
    totais.original += cronograma.creditoOriginal;
    totais.novado += cronograma.valorNovado;
    totais.desagio += cronograma.desagioAplicado;
    totais.juros += cronograma.totalJuros;
    totais.total += cronograma.totalPago;
    for (const p of cronograma.parcelas) {
      const agregado = porVencimento.get(p.vencimento)
        ?? { vencimento: p.vencimento, amortizacao: 0n, juros: 0n, valor: 0n, saldo: 0n };
      agregado.amortizacao += p.amortizacao;
      agregado.juros += p.juros;
      agregado.valor += p.valor;
      agregado.saldo += p.saldoFinal;
      porVencimento.set(p.vencimento, agregado);
    }
  }
  return {
    classe, dataBase, condicao, creditos: creditos.length,
    pendentesNoQgc: rows.filter((c) => c.classe_validada === null || c.sujeito_validado === null).length,
    totais, cronograma: [...porVencimento.values()],
    memoria: 'Centavos por crédito. O primeiro vencimento soma a carência e uma periodicidade ao marco; a última parcela absorve o saldo residual.',
  };
}
