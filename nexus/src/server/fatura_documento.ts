/**
 * Dados da fatura para o modelo do escritório (Word e PDF). O documento é montado no navegador a partir
 * do modelo oficial (`web/img/fatura/modelo.docx`), para sair idêntico ao que o financeiro já usa.
 */
import type { PoolClient } from 'pg';
import { NaoEncontrado } from './erros.ts';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const br = (iso: string) => iso.split('-').reverse().join('/');
const cnpjFmt = (c: string | null) => { const d = (c ?? '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : (c ?? ''); };
const reais = (centavos: number) => `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function dadosDaFatura(db: PoolClient, id: string) {
  const { rows } = await db.query<{ numero: string; descricao: string; valor: string; emissao: string; vencimento: string; pagador: string; razao: string | null; cnpj: string | null; projeto: string | null }>(
    `SELECT f.numero, f.descricao, f.valor_centavos::text AS valor, f.emissao::date::text AS emissao, f.vencimento::date::text AS vencimento, f.pagador,
            (SELECT coalesce(e.razao_social, e.nome_fantasia) FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = f.projeto_id ORDER BY pe.papel LIMIT 1) AS razao,
            (SELECT e.cnpj FROM projetos_empresas pe JOIN empresas e ON e.id = pe.empresa_id WHERE pe.projeto_id = f.projeto_id ORDER BY pe.papel LIMIT 1) AS cnpj,
            p.nome AS projeto
       FROM faturas f LEFT JOIN projetos p ON p.id = f.projeto_id WHERE f.id = $1`, [id]);
  const f = rows[0]; if (!f) throw new NaoEncontrado('fatura não encontrada');
  const [a, m, d] = f.emissao.split('-');
  const valor = Number(f.valor); const mes = MESES[Number(m) - 1]!;
  const cliente = (f.razao ?? f.pagador ?? f.projeto ?? '').toUpperCase();
  return {
    numero: f.numero, cidadeData: `Curitiba, ${d} de ${mes} de ${a}.`,
    cliente, cnpj: f.cnpj ? `CNPJ ${cnpjFmt(f.cnpj)}` : '',
    itens: [{ descricao: f.descricao, vencimento: br(f.vencimento), valor: reais(valor) }],
    total: reais(valor),
    arquivo: `Fatura ${mes[0]!.toUpperCase()}${mes.slice(1)} - ${cliente}`.replace(/[\\/:*?"<>|]+/g, ' ').trim(),
  };
}
