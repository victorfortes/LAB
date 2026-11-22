/**
 * Pré-diagnóstico a partir do CNPJ: o levantamento preliminar que se faz antes da primeira reunião com o cliente.
 *
 * Fontes públicas e gratuitas, sempre citadas no resultado:
 *  - Cadastro e quadro societário: BrasilAPI (base da Receita Federal); se cair, Minha Receita e CNPJ.ws.
 *  - Empresas ligadas: (1) sócio que é pessoa jurídica é aberto também (holding); (2) cruzamento com a base própria
 *    do LAB (toda empresa já consultada guarda o quadro societário) pelo nome + CPF mascarado do sócio;
 *    (3) CNPJ informado pela equipe. A busca reversa "todas as empresas desta pessoa" NÃO existe em fonte
 *    gratuita (os serviços que fazem isso são pagos ou bloqueiam robôs) — o resultado diz isso com todas as letras.
 *  - Processos: DJEN (comunicações dos tribunais, por nome da parte, com o polo), carteira do LAB (Astrea e
 *    processos) e números informados; depois o DataJud completa classe, órgão, assunto e último andamento.
 *
 * Feito em etapas curtas (cada chamada cabe no tempo da função na nuvem): cadastro → processos → DataJud.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditar } from '../store/conexao.ts';
import type { Identidade } from '../security/sessao.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import { validarCnpj } from '../domain/analise/identificadores.ts';
import { normalizar, similaridade } from '../domain/sentinela/nomes.ts';
import { consultar as consultarDataJud } from './datajud.ts';
import { indiceDataJud, lerHitsDataJud } from '../domain/processo/andamentos.ts';

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const formatarCnpj = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
const comMascara = (n: string) => { const d = so(n); return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : n; };
const UA = { 'user-agent': 'NGA-LAB/1.0 (pre-diagnostico)', accept: 'application/json' };

export const EsquemaNovo = z.object({ cnpj: z.string().trim().min(14).max(20), projetoId: z.string().uuid().nullable().optional() });
export const EsquemaLigar = z.object({ cnpj: z.string().trim().min(14).max(20) });
export const EsquemaNumeros = z.object({ numeros: z.array(z.string().trim().min(15).max(30)).min(1).max(200) });

export interface Socio { id: string; nome: string; tipo: 'PF' | 'PJ' | 'EX'; documento: string | null; qualificacao: string | null; entrada: string | null; faixa: string | null }
export interface Empresa {
  cnpj: string; razao: string; fantasia: string | null; situacao: string | null; dataSituacao: string | null; abertura: string | null; capital: number | null;
  porte: string | null; natureza: string | null; cnae: { codigo: string; descricao: string } | null; secundarios: { codigo: string; descricao: string }[];
  endereco: { logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; uf: string; cep: string } | null;
  telefones: string[]; emails: string[]; simples: boolean | null; socios: Socio[]; fonte: string;
}

/** Chave de cruzamento de sócio: nome normalizado + dígitos visíveis do CPF mascarado. */
export const chaveSocio = (s: Pick<Socio, 'nome' | 'documento'>) => `${normalizar(s.nome)}|${so(s.documento)}`;

function deBrasilApi(d: Record<string, any>, fonte: string): Empresa {
  const tel = [d.ddd_telefone_1, d.ddd_telefone_2].map(so).filter((x) => x.length >= 10).map((x) => `(${x.slice(0, 2)}) ${x.slice(2, -4)}-${x.slice(-4)}`);
  return {
    cnpj: so(d.cnpj), razao: d.razao_social ?? '', fantasia: d.nome_fantasia || null, situacao: d.descricao_situacao_cadastral ?? null, dataSituacao: d.data_situacao_cadastral ?? null,
    abertura: d.data_inicio_atividade ?? null, capital: d.capital_social != null ? Number(d.capital_social) : null, porte: d.porte ?? d.descricao_porte ?? null,
    natureza: d.natureza_juridica ?? null, cnae: d.cnae_fiscal ? { codigo: String(d.cnae_fiscal), descricao: d.cnae_fiscal_descricao ?? '' } : null,
    secundarios: (d.cnaes_secundarios ?? []).filter((c: any) => c?.codigo).map((c: any) => ({ codigo: String(c.codigo), descricao: c.descricao })),
    endereco: { logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '), numero: d.numero ?? '', complemento: d.complemento ?? '', bairro: d.bairro ?? '', municipio: d.municipio ?? '', uf: d.uf ?? '', cep: d.cep ?? '' },
    telefones: tel, emails: d.email ? [String(d.email).toLowerCase()] : [], simples: d.opcao_pelo_simples ?? null,
    socios: (d.qsa ?? []).map((s: any, i: number) => ({ id: `s${i}`, nome: s.nome_socio ?? '', tipo: s.identificador_de_socio === 1 ? 'PJ' : s.identificador_de_socio === 3 ? 'EX' : 'PF',
      documento: s.cnpj_cpf_do_socio || null, qualificacao: s.qualificacao_socio ?? null, entrada: s.data_entrada_sociedade ?? null, faixa: s.faixa_etaria ?? null })),
    fonte,
  };
}

/** Cadastro na Receita (BrasilAPI → Minha Receita). */
export async function buscarCnpj(cnpj: string, buscar: typeof fetch = fetch): Promise<Empresa> {
  const d = so(cnpj);
  if (!validarCnpj(d)) throw new PedidoInvalido('CNPJ inválido (confira os dígitos)');
  const fontes: [string, string][] = [['BrasilAPI (Receita Federal)', `https://brasilapi.com.br/api/cnpj/v1/${d}`], ['Minha Receita (Receita Federal)', `https://minhareceita.org/${d}`]];
  let ultimo = '';
  for (const [nome, url] of fontes) {
    try {
      const r = await buscar(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) throw new NaoEncontrado('CNPJ não encontrado na Receita Federal');
      if (!r.ok) { ultimo = `${nome} respondeu HTTP ${r.status}`; continue; }
      return deBrasilApi(await r.json() as Record<string, any>, nome);
    } catch (e) { if (e instanceof NaoEncontrado) throw e; ultimo = `${nome}: ${(e as Error).message}`; }
  }
  throw new PedidoInvalido(`as bases públicas da Receita não responderam agora (${ultimo}). Tente de novo em instantes.`);
}

async function guardarNaBase(db: PoolClient, org: string, e: Empresa) {
  await db.query(`INSERT INTO cnpj_cache (organizacao_id, cnpj, razao_social, dados, socios_chaves) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (organizacao_id, cnpj) DO UPDATE SET razao_social = EXCLUDED.razao_social, dados = EXCLUDED.dados, socios_chaves = EXCLUDED.socios_chaves, consultado_em = now()`,
    [org, e.cnpj, e.razao, JSON.stringify(e), e.socios.map(chaveSocio)]);
}

async function org(db: PoolClient, i: Identidade) {
  const o = i.organizacoes.find((x) => x.tipo === 'escritorio')?.id; if (!o) throw new PedidoInvalido('só a equipe do escritório faz pré-diagnóstico');
  return o;
}
async function carregar(db: PoolClient, id: string) {
  const { rows } = await db.query<{ id: string; organizacao_id: string; projeto_id: string | null; cnpj: string; dados: any; etapa: string; criado_em: Date; atualizado_em: Date; razao_social: string | null }>(
    'SELECT * FROM prediagnosticos WHERE id = $1', [id]);
  if (!rows[0]) throw new NaoEncontrado('pré-diagnóstico não encontrado');
  return rows[0];
}
async function salvar(db: PoolClient, id: string, dados: unknown, etapa?: string) {
  await db.query(`UPDATE prediagnosticos SET dados = $2, etapa = coalesce($3, etapa), atualizado_em = now() WHERE id = $1`, [id, JSON.stringify(dados), etapa ?? null]);
}

/** Empresas ligadas: sócio PJ (abre o CNPJ dele) e cruzamento com a base própria pelo sócio PF. */
async function ligadas(db: PoolClient, organizacao: string, e: Empresa, buscar: typeof fetch) {
  const lista: any[] = []; const vistas = new Set([e.cnpj]);
  for (const s of e.socios.filter((x) => x.tipo === 'PJ' && so(x.documento).length === 14)) {
    const c = so(s.documento); if (vistas.has(c)) continue; vistas.add(c);
    try { const x = await buscarCnpj(c, buscar); await guardarNaBase(db, organizacao, x); lista.push({ ...resumoEmpresa(x), via: [s.nome], relacao: 'sócia (pessoa jurídica)', origem: 'socio_pj' }); }
    catch { lista.push({ cnpj: c, razao: s.nome, via: [s.nome], relacao: 'sócia (pessoa jurídica)', origem: 'socio_pj', erro: 'cadastro indisponível agora' }); }
  }
  const chaves = e.socios.filter((x) => x.tipo === 'PF').map(chaveSocio).filter((k) => !k.endsWith('|'));
  if (chaves.length) {
    const { rows } = await db.query<{ cnpj: string; dados: Empresa }>(`SELECT cnpj, dados FROM cnpj_cache WHERE organizacao_id = $1 AND socios_chaves && $2::text[] AND cnpj <> $3`, [organizacao, chaves, e.cnpj]);
    for (const r of rows) {
      if (vistas.has(r.cnpj)) continue; vistas.add(r.cnpj);
      const via = r.dados.socios.filter((s) => chaves.includes(chaveSocio(s))).map((s) => `${s.nome} (${s.qualificacao ?? 'sócio'})`);
      lista.push({ ...resumoEmpresa(r.dados), via, relacao: 'mesmo sócio', origem: 'base_lab' });
    }
  }
  return lista;
}
const resumoEmpresa = (x: Empresa) => ({ cnpj: x.cnpj, razao: x.razao, fantasia: x.fantasia, situacao: x.situacao, capital: x.capital, cnae: x.cnae, municipio: x.endereco ? `${x.endereco.municipio}/${x.endereco.uf}` : null,
  telefones: x.telefones, emails: x.emails, socios: x.socios.map(({ nome, tipo, documento, qualificacao }) => ({ nome, tipo, documento, qualificacao })) });

/** Etapa 1: cadastro, sócios e empresas ligadas. */
export async function criar(db: PoolClient, d: z.infer<typeof EsquemaNovo>, i: Identidade, buscar: typeof fetch = fetch) {
  const organizacao = await org(db, i);
  const e = await buscarCnpj(d.cnpj, buscar);
  await guardarNaBase(db, organizacao, e);
  const ligs = await ligadas(db, organizacao, e, buscar);
  const dados = {
    empresa: e, ligadas: ligs, processos: [] as unknown[],
    fontes: { cadastro: { fonte: e.fonte, em: new Date().toISOString() } },
    avisos: ['A busca de "todas as empresas de uma pessoa" não existe em fonte pública gratuita: as empresas ligadas vêm de sócio pessoa jurídica, da base própria do LAB e do que a equipe informar.'],
  };
  const { rows: [r] } = await db.query<{ id: string }>(`INSERT INTO prediagnosticos (organizacao_id, projeto_id, cnpj, razao_social, dados, etapa, criado_por) VALUES ($1,$2,$3,$4,$5,'processos',$6) RETURNING id`,
    [organizacao, d.projetoId ?? null, e.cnpj, e.razao, JSON.stringify(dados), i.usuarioId]);
  await auditar(db, { organizacaoId: organizacao, usuarioId: i.usuarioId, acao: 'prediagnostico.criado', entidade: 'prediagnostico', entidadeId: r!.id, depois: { cnpj: e.cnpj, razao: e.razao } });
  return obter(db, r!.id);
}

export async function ligarEmpresa(db: PoolClient, id: string, d: z.infer<typeof EsquemaLigar>, i: Identidade, buscar: typeof fetch = fetch) {
  const p = await carregar(db, id); const x = await buscarCnpj(d.cnpj, buscar); await guardarNaBase(db, p.organizacao_id, x);
  const dados = p.dados; dados.ligadas = (dados.ligadas ?? []).filter((l: any) => l.cnpj !== x.cnpj);
  const chaves = new Set((dados.empresa.socios as Socio[]).map(chaveSocio));
  const via = x.socios.filter((s) => chaves.has(chaveSocio(s))).map((s) => `${s.nome} (${s.qualificacao ?? 'sócio'})`);
  dados.ligadas.push({ ...resumoEmpresa(x), via, relacao: via.length ? 'mesmo sócio' : 'informada pela equipe', origem: 'manual' });
  await salvar(db, id, dados);
  void i; return obter(db, id);
}

const NOMES_FRACOS = /\b(LTDA|S\/?A|EIRELI|ME|EPP|MEI)\b\.?/g;
const SUFIXOS = /\s*(?:[-–,]\s*)?\b(LTDA|LIMITADA|S\/?A|EIRELI|EPP|MEI|ME)\b\.?/gi;
/**
 * O DJEN casa o nome EXATO da parte. A empresa costuma aparecer nos autos com o nome antigo (EIRELI que virou
 * LTDA, ME/EPP no fim, sem o sufixo): "F W E SILVA LTDA" não acha nada, "F W E SILVA EIRELI" acha seis
 * processos. Então tenta o nome sem sufixo e com cada sufixo usual, além do nome fantasia.
 */
export function variacoesDeNome(razao: string, fantasia: string | null): string[] {
  const base = razao.replace(/\s+EM\s+RECUPERA[CÇ][AÃ]O\s+JUDICIAL.*$/i, '').replace(SUFIXOS, ' ').replace(/[-–,]\s*$/, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const lista = [razao.toUpperCase().trim(), base, `${base} LTDA`, `${base} EIRELI`, `${base} EIRELI ME`, `${base} ME`, `${base} EPP`, `${base} S/A`, `${base} S.A.`];
  if (fantasia && fantasia.trim().length >= 4) lista.push(fantasia.toUpperCase().trim());
  return [...new Set(lista.filter((x) => x.replace(/\W/g, '').length >= 4))];
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Etapa 2: processos pelo DJEN (variações do nome, CNPJ no texto, sócios) e pela carteira do LAB. */
export async function buscarProcessos(db: PoolClient, id: string, buscar: typeof fetch = fetch, pausa = 350) {
  const p = await carregar(db, id); const dados = p.dados; const e: Empresa = dados.empresa;
  const nomes = variacoesDeNome(e.razao, e.fantasia);
  const alvo = [...new Set(nomes.map((n) => normalizar(n).replace(NOMES_FRACOS, '').trim()))];
  const porNumero = new Map<string, any>();
  const add = (mapa: Map<string, any>, numero: string, info: Record<string, unknown>) => {
    const k = so(numero); if (k.length !== 20) return;
    const atual = mapa.get(k) ?? { numero: comMascara(k), fontes: [], polo: null, partes: [], publicacoes: 0, comoConsta: [] };
    for (const [c, v] of Object.entries(info)) {
      if (c === 'fonte') { if (!atual.fontes.includes(v)) atual.fontes.push(v); }
      else if (c === 'parte') { if (v && !atual.partes.includes(v) && atual.partes.length < 6) atual.partes.push(v); }
      else if (c === 'comoConsta') { if (v && !atual.comoConsta.includes(v) && atual.comoConsta.length < 3) atual.comoConsta.push(v); }
      else if (c === 'publicacoes') atual.publicacoes += Number(v);
      else if (v != null && (atual[c] == null || c === 'ultimaPublicacao' && String(v) > String(atual[c]))) atual[c] = v;
    }
    mapa.set(k, atual);
  };
  const avisos: string[] = []; let itensDjen = 0; const achouPor: Record<string, number> = {};
  /** Uma consulta ao DJEN; `aceitar` decide se a comunicação é mesmo da pessoa procurada. */
  const djen = async (param: string, valor: string, paginas: number, aceitar: (it: any) => { quem: { nome: string; polo: string } | null } | null, mapa: Map<string, any>) => {
    let achados = 0;
    for (let pagina = 1; pagina <= paginas; pagina++) {
      try {
        const q = new URLSearchParams({ [param]: valor, pagina: String(pagina), itensPorPagina: '100' });
        let r = await buscar(`https://comunicaapi.pje.jus.br/api/v1/comunicacao?${q}`, { headers: UA, signal: AbortSignal.timeout(25_000) });
        if (r.status === 429) { await espera(2500); r = await buscar(`https://comunicaapi.pje.jus.br/api/v1/comunicacao?${q}`, { headers: UA, signal: AbortSignal.timeout(25_000) }); }
        if (r.status === 429) { avisos.push(`O DJEN pediu para aguardar na busca "${valor}". Rode "Buscar processos" de novo em alguns minutos.`); break; }
        if (!r.ok) { avisos.push(`DJEN respondeu HTTP ${r.status} para "${valor}"`); break; }
        const j = await r.json() as { count?: number; items?: any[] };
        for (const it of j.items ?? []) {
          itensDjen++;
          const ok = aceitar(it); if (!ok) continue;
          const dest = (it.destinatarios ?? []) as { nome: string; polo: string }[];
          const contra = dest.filter((x) => x !== ok.quem && x.polo !== ok.quem?.polo).map((x) => x.nome);
          const antes = mapa.has(so(it.numero_processo));
          add(mapa, it.numero_processo, { fonte: 'DJEN', tribunal: it.siglaTribunal, orgao: it.nomeOrgao, classe: it.nomeClasse, polo: ok.quem?.polo === 'A' ? 'ativo' : ok.quem?.polo === 'P' ? 'passivo' : null,
            ultimaPublicacao: it.data_disponibilizacao, publicacoes: 1, parte: contra[0] ?? null, comoConsta: ok.quem?.nome ?? null });
          for (const c of contra.slice(1, 3)) add(mapa, it.numero_processo, { parte: c });
          if (!antes) achados++;
        }
        if ((j.items ?? []).length < 100) break;
      } catch (er) { avisos.push(`DJEN indisponível agora (${(er as Error).message.slice(0, 60)})`); break; }
      await espera(pausa);
    }
    await espera(pausa);
    return achados;
  };
  const daEmpresa = (it: any) => {
    const dest = (it.destinatarios ?? []) as { nome: string; polo: string }[];
    const melhor = dest.map((x) => ({ x, s: Math.max(...alvo.map((a) => similaridade(normalizar(String(x.nome)).replace(NOMES_FRACOS, '').trim(), a))) })).sort((a, b) => b.s - a.s)[0];
    if (melhor && melhor.s >= 0.92) return { quem: melhor.x };
    return so(it.texto).includes(e.cnpj) ? { quem: null } : null;
  };
  for (const n of nomes) achouPor[n] = await djen('nomeParte', n, 3, daEmpresa, porNumero);
  achouPor[formatarCnpj(e.cnpj)] = await djen('texto', formatarCnpj(e.cnpj), 2, daEmpresa, porNumero);
  // Processos dos sócios pessoa física (pelo nome completo): exposição pessoal e outras empresas em que aparecem.
  const porSocio = new Map<string, any>();
  for (const sc of e.socios.filter((x) => x.tipo === 'PF' && x.nome.trim().split(/\s+/).length >= 3).slice(0, 4)) {
    const alvoSocio = normalizar(sc.nome);
    achouPor[sc.nome] = await djen('nomeParte', sc.nome, 1, (it) => {
      const quem = ((it.destinatarios ?? []) as { nome: string; polo: string }[]).find((x) => similaridade(normalizar(String(x.nome)), alvoSocio) >= 0.97);
      return quem ? { quem } : null;
    }, porSocio);
    for (const v of porSocio.values()) v.socio ??= sc.nome;
  }
  // Carteira do LAB (Astrea): o cliente pode já ser cliente do escritório.
  const { rows: lab } = await db.query<{ numero: string; titulo: string | null; papel: string | null; vara: string | null; acao: string | null }>(
    `SELECT coalesce(numero_original, '') numero, titulo, papel_cliente papel, vara, acao FROM astrea_registros
      WHERE upper(coalesce(cliente_nome, '')) = ANY($1::text[]) OR upper(coalesce(outros_envolvidos, '')) LIKE ANY($2::text[]) LIMIT 300`,
    [nomes, nomes.map((n) => `%${n}%`)]).catch(() => ({ rows: [] as any[] }));
  for (const x of lab) add(porNumero, x.numero, { fonte: 'Carteira do LAB', orgao: x.vara, classe: x.acao, polo: /autor|exequente|requerente|reclamante|embargante/i.test(x.papel ?? '') ? 'ativo' : /r[ée]u|executad|requerid|reclamad/i.test(x.papel ?? '') ? 'passivo' : null });
  const antigos = new Map(((dados.processos ?? []) as any[]).map((x) => [so(x.numero), x]));
  for (const [k, v] of porNumero) { const a = antigos.get(k); if (a?.datajud) v.datajud = a.datajud; if (a?.fontes?.includes('Informado pela equipe')) v.fontes.push('Informado pela equipe'); }
  for (const [k, a] of antigos) if (!porNumero.has(k) && a.fontes?.includes('Informado pela equipe')) porNumero.set(k, a);
  dados.processos = [...porNumero.values()].sort((a, b) => String(b.ultimaPublicacao ?? '').localeCompare(String(a.ultimaPublicacao ?? '')));
  for (const k of porNumero.keys()) porSocio.delete(k);
  dados.processosSocios = [...porSocio.values()].sort((a, b) => String(b.ultimaPublicacao ?? '').localeCompare(String(a.ultimaPublicacao ?? '')));
  dados.fontes.processos = { djen: { consultas: Object.keys(achouPor), achouPor, itens: itensDjen }, em: new Date().toISOString(), avisos };
  await salvar(db, id, dados, 'datajud');
  return obter(db, id);
}

export async function incluirNumeros(db: PoolClient, id: string, d: z.infer<typeof EsquemaNumeros>) {
  const p = await carregar(db, id); const dados = p.dados; const lista = (dados.processos ?? []) as any[];
  for (const n of d.numeros) { const k = so(n); if (k.length !== 20 || lista.some((x) => so(x.numero) === k)) continue; lista.push({ numero: comMascara(k), fontes: ['Informado pela equipe'], polo: null, partes: [], publicacoes: 0 }); }
  dados.processos = lista; await salvar(db, id, dados, 'datajud');
  return obter(db, id);
}

/** Etapa 3: DataJud por tribunal (uma chamada por vez; a tela repete até acabar). */
export async function enriquecer(db: PoolClient, id: string, buscar: typeof fetch = fetch) {
  const p = await carregar(db, id); const dados = p.dados; const lista = (dados.processos ?? []) as any[];
  const pend = lista.filter((x) => !x.datajud && indiceDataJud(x.numero));
  if (!pend.length) { await salvar(db, id, dados, 'pronto'); return { ...(await obter(db, id)), restantes: 0 }; }
  const indice = indiceDataJud(pend[0].numero)!; const grupo = pend.filter((x) => indiceDataJud(x.numero) === indice).slice(0, 40);
  const r = await consultarDataJud(indice, grupo.map((x) => x.numero), { campos: ['numeroProcesso', 'grau', 'classe', 'orgaoJulgador', 'assuntos', 'dataAjuizamento', 'movimentos', 'tribunal'], buscar, tentativas: 1 });
  for (const x of grupo) {
    if (r.tipo !== 'ok') { x.datajud = { estado: 'instavel', motivo: r.motivo }; continue; }
    const hits = r.porNumero.get(so(x.numero)) ?? [];
    if (!hits.length) { x.datajud = { estado: r.incompleto ? 'instavel' : 'nao_encontrado' }; continue; }
    const { movimentos, capa } = lerHitsDataJud(hits);
    const ult = movimentos[0] ?? null; const graus = [...new Set(hits.map((h) => h._source.grau).filter(Boolean))];
    x.datajud = { estado: 'ok', classe: capa.classe ?? null, orgao: capa.orgao ?? null, assunto: capa.assunto ?? null, ajuizamento: capa.ajuizamento ?? null, graus,
      ultimoMovimento: ult ? { data: ult.data, titulo: ult.titulo } : null, movimentos: movimentos.length,
      // Indício de encerramento pelos movimentos (arquivamento definitivo/baixa).
      arquivado: movimentos.slice(0, 5).some((m) => /arquivad[oa] definitivamente|baixa definitiva|arquivamento definitivo/i.test(m.titulo)) };
    x.tribunal ??= capa.tribunal ?? indice.toUpperCase();
  }
  // Instável não trava: na próxima chamada, tenta os outros tribunais; esses voltam no fim.
  if (r.tipo !== 'ok') for (const x of grupo) x.datajud.tentativas = (x.datajud.tentativas ?? 0) + 1;
  const restantes = lista.filter((x) => (!x.datajud || (x.datajud.estado === 'instavel' && (x.datajud.tentativas ?? 0) < 2)) && indiceDataJud(x.numero)).length;
  dados.fontes.datajud = { em: new Date().toISOString(), restantes };
  await salvar(db, id, dados, restantes ? 'datajud' : 'pronto');
  return { ...(await obter(db, id)), restantes, tribunal: indice.toUpperCase(), ok: r.tipo === 'ok' };
}

/** Leitura com o resumo calculado (o que a tela e o PDF mostram). */
export async function obter(db: PoolClient, id: string) {
  const p = await carregar(db, id); const d = p.dados; const procs = (d.processos ?? []) as any[];
  const emCurso = procs.filter((x) => !x.datajud?.arquivado).length;
  const tribunais = [...new Set(procs.map((x) => x.tribunal).filter(Boolean))];
  const contrapartes = new Map<string, number>(); for (const x of procs) for (const c of x.partes ?? []) contrapartes.set(c, (contrapartes.get(c) ?? 0) + 1);
  const anos = procs.map((x) => x.datajud?.ajuizamento?.slice(0, 4) ?? x.numero.slice(11, 15)).filter((a) => /^\d{4}$/.test(a)).sort();
  return {
    id: p.id, projetoId: p.projeto_id, cnpj: p.cnpj, cnpjFormatado: formatarCnpj(p.cnpj), etapa: p.etapa, criadoEm: p.criado_em, atualizadoEm: p.atualizado_em,
    empresa: d.empresa, ligadas: d.ligadas ?? [], processos: procs, processosSocios: d.processosSocios ?? [], fontes: d.fontes ?? {}, avisos: [...(d.avisos ?? []), ...(d.fontes?.processos?.avisos ?? [])],
    resumo: {
      processos: procs.length, emCurso, arquivados: procs.length - emCurso,
      ativo: procs.filter((x) => x.polo === 'ativo').length, passivo: procs.filter((x) => x.polo === 'passivo').length,
      tribunais, periodo: anos.length ? `${anos[0]} a ${anos[anos.length - 1]}` : null,
      recorrentes: [...contrapartes].filter(([, n]) => n > 1).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n).slice(0, 8),
      socios: (d.empresa?.socios ?? []).length, ligadas: (d.ligadas ?? []).length,
    },
  };
}

export async function listar(db: PoolClient, projetoId: string | null) {
  const { rows } = await db.query(`SELECT p.id, p.cnpj, p.razao_social "razao", p.etapa, p.projeto_id "projetoId", p.criado_em "criadoEm", u.nome "criadoPor",
      jsonb_array_length(coalesce(p.dados->'processos', '[]')) processos FROM prediagnosticos p LEFT JOIN usuarios u ON u.id = p.criado_por
     WHERE ($1::uuid IS NULL OR p.projeto_id = $1) ORDER BY p.criado_em DESC LIMIT 60`, [projetoId]);
  return rows;
}

export async function vincularProjeto(db: PoolClient, id: string, projetoId: string, i: Identidade) {
  const p = await carregar(db, id);
  await db.query('UPDATE prediagnosticos SET projeto_id = $2, atualizado_em = now() WHERE id = $1', [id, projetoId]);
  await auditar(db, { organizacaoId: p.organizacao_id, usuarioId: i.usuarioId, acao: 'prediagnostico.vinculado', entidade: 'projeto', entidadeId: projetoId, depois: { prediagnostico: id } });
  return { ok: true };
}
