/**
 * API da plataforma.
 *
 * Toda rota autenticada roda dentro de `banco.comoUsuario`, então o RLS está
 * ativo em cada consulta. O RBAC é verificado antes, no `exigir`.
 */
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Banco, auditar } from '../store/conexao.ts';
import { ErroDeAutenticacao, autenticar, identidadeDoToken, revogar, type Identidade } from '../security/sessao.ts';
import { SemPermissao, exigir, PERMISSOES, type Permissao } from '../security/rbac.ts';
import { type Credito, consolidarPorClasse, desdobrarParaVotacao, enquadrar } from '../domain/insolvencia/creditos.ts';
import { apurarAssembleia, type VotoLancado } from '../domain/insolvencia/quorum.ts';
import { gerarCronograma, type CondicaoDePagamento } from '../domain/insolvencia/plano.ts';
import { formatarReais } from '../domain/shared/dinheiro.ts';
import { AMBIENTES, MODULOS, resumoDeEstado } from './modulos.ts';
import { TransicaoInvalida } from '../domain/portal/checklist.ts';
import * as portal from './portal.ts';
import * as analise from './analise.ts';
import * as analiseAuto from './analise_auto.ts';
import { diagnostico } from './diagnostico.ts';
import { atividade } from './atividade.ts';
import * as negociacoes from './negociacoes.ts';
import * as controladoria from './controladoria.ts';
import * as gerador from './gerador.ts';
import { sugerirPrazo } from './publicacao_analise.ts';
import { faseInicial, type TipoDeProjeto } from '../domain/projeto/fases.ts';
import * as processos from './processos.ts';
import * as relatorios from './relatorios.ts';
import * as projetos from './projetos.ts';
import * as playbookConfig from './playbook_config.ts';
import * as tarefas from './tarefas.ts';
import * as equipeAdmin from './equipe.ts';
import * as projetoConfig from './projeto_config.ts';
import * as ferramentas from './ferramentas.ts';
import * as ferramentaSso from './ferramenta_sso.ts';
import * as convites from './convites.ts';
import * as integracoes from './integracoes.ts';
import * as google from './google.ts';
import {
  SemEscopo, exigirEscopo, integracaoDoToken, marcarUso, pareceTokenDeIntegracao,
} from '../security/integracao.ts';
import { TransicaoDeFaseInvalida } from '../domain/projeto/fases.ts';
import { PRAZOS_USUAIS } from '../domain/processo/prazos.ts';
import { calendarioNacional, noRecesso } from '../domain/processo/feriados.ts';
import { ErroDePrazo } from '../domain/processo/prazos.ts';
import { NaoEncontrado, PedidoInvalido } from './erros.ts';
import * as arquivos from './arquivos.ts';
import { ArmazenamentoLocal, ArquivoAusente, ArquivoCorrompido } from '../store/arquivos.ts';
import { TipoRecusado } from '../store/tipos-de-arquivo.ts';
import { AssinaturaExpirada, AssinaturaInvalida, verificar } from '../security/assinatura.ts';
import { ProvedorIndisponivel, provedorDoAmbiente, type Provedor } from '../ai/provedor.ts';

const COOKIE = 'nga_sessao';

/**
 * Identidade mínima para o usuário de serviço de uma integração.
 *
 * `arquivos.receber` audita em nome de quem enviou, e quem envia aqui é a
 * aplicação. Os papéis vêm vazios de propósito: o RBAC da ingestão já foi
 * conferido pelo escopo da credencial, e passar papéis daria a impressão de
 * que a integração pode o que um usuário pode.
 */
function identidadeDeServico(usuarioId: string): Identidade {
  return {
    usuarioId, nome: 'integração', email: '', papeis: [], organizacoes: [],
  };
}

export interface Contexto {
  readonly banco: Banco;
  /**
   * Provedor de IA. Omitido, vem do ambiente — e sem chave vem o provedor
   * ausente, que recusa a chamada e nomeia o impedimento. Nunca um substituto
   * que finge responder (§22).
   */
  readonly provedor?: Provedor;
  /** Lê e analisa sozinho o que chega. Desligado por padrão para não deixar trabalho solto nos testes. */
  readonly analiseAutomatica?: boolean;
  readonly analiseEmWorker?: boolean;
  /** Fonte do DJEN. Em testes entra uma fake; em produção, a API pública do CNJ. */
  readonly buscadorDjen?: controladoria.Buscador;
  /**
   * Depósito de arquivos. Omitido, usa o armazenamento local em `acervo/` —
   * que fica FORA de `web/`, senão a URL assinada seria enfeite: bastaria
   * pedir o arquivo pelo caminho estático (§12.4).
   */
  readonly deposito?: arquivos.Deposito;
}

/** JSON com BigInt: centavos viram string, nunca Number (perderia precisão). */
function json(dados: unknown, status = 200): Response {
  const corpo = JSON.stringify(dados, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return new Response(corpo, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'vary': 'Cookie, Authorization' } });
}

function erro(mensagem: string, status: number, detalhe?: unknown): Response {
  return json({ erro: mensagem, detalhe }, status);
}

function tokenDaRequisicao(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (m?.[1]) {
    try { return decodeURIComponent(m[1]); } catch { return null; }
  }
  const auth = req.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

export function criarApp(ctx: Contexto) {
  const { banco } = ctx;
  const provedor = ctx.provedor ?? provedorDoAmbiente();
  const deposito = ctx.deposito
    ?? arquivos.deposito(new ArmazenamentoLocal(process.env['NGA_ACERVO'] ?? './acervo'));
  if (deposito.segredo.aviso) console.warn(`  aviso: ${deposito.segredo.aviso}`);

  // Leitura automática dos documentos recebidos. Roda depois da resposta, fora
  // da requisição; o estado de cada documento fica gravado e a tela o mostra.
  const pendentes = new Set<Promise<unknown>>();
  const agendarAnalise = (documentoId: string): void => {
    if (!ctx.analiseAutomatica) return;
    const p = analiseAuto.processar(banco, deposito, provedor, documentoId).finally(() => pendentes.delete(p));
    pendentes.add(p);
  };

  /** Resolve a identidade ou devolve 401. */
  async function autenticado(req: Request): Promise<Identidade | Response> {
    const token = tokenDaRequisicao(req);
    if (!token) return erro('não autenticado', 401);
    const identidade = await banco.semContexto((db) => identidadeDoToken(db, token));
    return identidade ?? erro('sessão inválida ou expirada', 401);
  }

  const tratar = async function tratar(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rota = url.pathname;
    const metodo = req.method;

    try {
      // ---------------------------------------------------------- download ---
      // A concessão curta é válida apenas para a conta que emitiu o link,
      // com sessão ativa. A leitura continua sujeita às permissões atuais.
      if (rota.startsWith('/arquivos/')) {
        if (metodo !== 'GET' && metodo !== 'HEAD') return erro('método não permitido', 405);
        const identidade = await autenticado(req);
        if (identidade instanceof Response) return identidade;
        exigir(identidade.papeis, 'documento.ler');
        const concessao = verificar(rota.slice('/arquivos/'.length), deposito.segredo.valor);
        if (concessao.usuarioId !== identidade.usuarioId) return erro('link pertence a outra conta', 403);
        const conteudo = await banco.comoUsuario(identidade.usuarioId, (db) =>
          arquivos.entregar(db, concessao.documentoId, identidade.usuarioId, deposito));
        const resposta = arquivos.respostaDeDownload(conteudo);
        return metodo === 'HEAD' ? new Response(null, { headers: resposta.headers }) : resposta;
      }

      // --------------------------------------------------- integração ---
      // Autenticação por token de aplicação, ANTES do cookie: as aplicações do
      // NGA Lab não têm sessão de usuário. A ingestão roda em
      // `comoUsuario(usuario de serviço)`, então o RLS vale igual.
      if (rota.startsWith('/api/integracao/')) {
        const bruto = tokenDaRequisicao(req);
        if (!bruto || !pareceTokenDeIntegracao(bruto)) {
          return erro('credencial de integração ausente ou mal formada', 401);
        }
        const integracao = await banco.semContexto((db) => integracaoDoToken(db, bruto));
        if (!integracao) return erro('credencial de integração inválida ou revogada', 401);

        if (rota === '/api/integracao/contrato' && metodo === 'GET') {
          return json({ ...integracoes.contrato(), suaCredencial: {
            nome: integracao.nome, aplicacao: integracao.aplicacao, escopos: integracao.escopos,
          } });
        }
        if (metodo !== 'POST') return erro('método não permitido', 405);

        const entregue = await (async () => {
          if (rota === '/api/integracao/processos') {
            exigirEscopo(integracao, 'processos');
            const corpo = integracoes.EsquemaProcessosRecebidos
              .safeParse(await req.json().catch(() => null));
            if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
            return json(await banco.comoUsuario(integracao.usuarioId, (db) =>
              integracoes.receberProcessos(db, integracao, corpo.data)), 201);
          }

          if (rota === '/api/integracao/prazos') {
            exigirEscopo(integracao, 'prazos');
            const corpo = integracoes.EsquemaPrazosRecebidos
              .safeParse(await req.json().catch(() => null));
            if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
            return json(await banco.comoUsuario(integracao.usuarioId, (db) =>
              integracoes.receberPrazos(db, integracao, corpo.data)), 201);
          }

          if (rota === '/api/integracao/documentos') {
            exigirEscopo(integracao, 'documentos');
            const formulario = await req.formData().catch(() => null);
            const arquivo = formulario?.get('arquivo');
            const numeroProcesso = String(formulario?.get('numeroProcesso') ?? '');
            if (!(arquivo instanceof File)) return erro('campo "arquivo" ausente', 400);

            return json(await banco.comoUsuario(integracao.usuarioId, async (db) => {
              const { projetoId } = await integracoes.projetoDoProcesso(
                db, integracao.organizacaoId, numeroProcesso);
              const meta = arquivos.EsquemaMetadados.safeParse({
                titulo: formulario?.get('titulo') ?? arquivo.name,
                categoria: formulario?.get('categoria') ?? 'Autos',
              });
              if (!meta.success) throw new PedidoInvalido('título inválido');
              // Vai para o acervo como qualquer documento: endereçado por
              // conteúdo, interno, baixado por URL assinada.
              return arquivos.receber(
                db, projetoId, arquivo, meta.data,
                { ...identidadeDeServico(integracao.usuarioId) }, deposito, 'interno');
            }), 201);
          }

          return erro('rota de integração não encontrada', 404);
        })();

        await banco.semContexto((db) => marcarUso(db, integracao.id));
        return entregue;
      }

      if (rota === '/definir-senha' && metodo === 'GET') return equipeAdmin.paginaSenha();
      if (rota === '/api/equipe/definir-senha' && metodo === 'POST') {
        const d=equipeAdmin.EsquemaSenha.safeParse(await req.json().catch(()=>null));
        if(!d.success) return erro('dados inválidos',400);
        try { return json(await banco.semContexto(db=>equipeAdmin.definirSenha(db,d.data))); }
        catch { return erro('link inválido ou expirado',400); }
      }

      // ------------------------------------------------------------ sessão ---
      if (rota === '/api/sessao' && metodo === 'POST') {
        const corpo = EsquemaLogin.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        const { token, expiraEm } = await banco.semContexto((db) =>
          autenticar(db, corpo.data.email, corpo.data.senha, {
            ip: req.headers.get('x-forwarded-for') ?? undefined,
            agente: req.headers.get('user-agent') ?? undefined,
          }));
        return new Response(JSON.stringify({ ok: true, expiraEm }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'set-cookie':
              `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; ${url.protocol === 'https:' ? 'Secure; ' : ''}` +
              `Max-Age=${Math.floor((expiraEm.getTime() - Date.now()) / 1000)}`,
          },
        });
      }

      if (rota === '/api/sessao' && metodo === 'DELETE') {
        const token = tokenDaRequisicao(req);
        if (token) await banco.semContexto((db) => revogar(db, token));
        return new Response(null, {
          status: 204,
          headers: { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; ${url.protocol === 'https:' ? 'Secure; ' : '' }Max-Age=0` },
        });
      }

      // Google returns cross-site: relay through a same-origin document so Strict session cookies
      // remain strict and the actual token exchange still requires the initiating user's session.
      if (rota === '/api/google/callback' && metodo === 'GET') {
        const code=url.searchParams.get('code'); const state=url.searchParams.get('state');
        if(!code || !state || code.length>4096 || state.length>256) return erro('Autorização Google recusada ou incompleta.',400);
        const next='/api/google/finalizar?'+new URLSearchParams({code,state});
        const nonce=crypto.randomUUID();
        const script='location.replace('+JSON.stringify(next).replaceAll('<','\\u003c')+')';
        return new Response('<!doctype html><meta charset="utf-8"><title>Conectando Google</title><p>Concluindo conexão Google…</p><script nonce="'+nonce+'">'+script+'</script>',{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'"}});
      }

      if(rota==='/api/sso/consumir'&&metodo==='POST'){
        const d=z.object({ferramenta:z.enum(ferramentaSso.FERRAMENTAS_SSO),ticket:z.string().max(128),state:z.string().max(128)}).safeParse(await req.json().catch(()=>null));
        if(!d.success)return erro('Acesso inválido.',400);
        const bearer=(req.headers.get('authorization')??'').replace(/^Bearer /,'');
        if(!ferramentaSso.conferirServicoSso(d.data.ferramenta,bearer))return erro('Acesso negado.',403);
        const response=json(await banco.semContexto(db=>ferramentaSso.consumirAcessoSso(db,d.data.ferramenta,d.data.ticket,d.data.state)));response.headers.set('cache-control','no-store');return response;
      }
      // A same-origin document restores Strict LAB cookies after returning from the tool.
      const relaySso=/^\/api\/ferramentas\/(prazos|sentinela)\/autorizar$/.exec(rota);
      if(relaySso&&metodo==='GET'){
        const ticket=url.searchParams.get('ticket')??'';const state=url.searchParams.get('state')??'';
        if(!/^[A-Za-z0-9_-]{32,128}$/.test(ticket)||!/^[A-Za-z0-9_-]{32,128}$/.test(state))return erro('Acesso inválido.',400);
        const next=rota.replace(/autorizar$/,'confirmar')+'?'+new URLSearchParams({ticket,state});const nonce=crypto.randomUUID();
        return new Response('<!doctype html><meta charset="utf-8"><title>Acesso NGA LAB</title><p>Confirmando seu acesso…</p><script nonce="'+nonce+'">location.replace('+JSON.stringify(next).replaceAll('<','\\u003c')+')</script>',{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'"}});
      }

      // --------------------------------------------------------- autenticado ---
      const identidade = await autenticado(req);
      if (identidade instanceof Response) return identidade;

      const permissoes = [...new Set(identidade.papeis.flatMap((p) => PERMISSOES[p]))];
      // Cliente é quem NÃO tem vínculo com o escritório. Decidido aqui, uma vez.
      const ehCliente = !identidade.organizacoes.some((o) => o.tipo === 'escritorio');

      if (rota === '/api/eu' && metodo === 'GET') {
        return json({
          usuario: { id: identidade.usuarioId, nome: identidade.nome, email: identidade.email },
          papeis: identidade.papeis,
          organizacoes: identidade.organizacoes,
          permissoes,
          ehCliente,
        });
      }

      if (rota === '/api/modulos' && metodo === 'GET') {
        // O catálogo declara o estado REAL de cada módulo; a interface mostra
        // esse estado em vez de fingir que tudo está pronto (§18).
        return json({
          ambientes: AMBIENTES,
          // O cliente vê só o ambiente NGA CLIENT; a equipe vê tudo. Sem isto,
          // o portal exibiria ao cliente a existência de módulos internos.
          modulos: MODULOS.filter((m) =>
            ehCliente ? m.ambiente === 'client' : true),
          resumo: resumoDeEstado(),
        });
      }

      // ------------------------------------------------------ Google ---
      if (rota.startsWith('/api/google/')) {
        exigir(identidade.papeis, 'projeto.ler');
        if (rota === '/api/google/status' && metodo === 'GET') return json(await banco.comoUsuario(identidade.usuarioId, db => google.status(db, identidade)));
        if (rota === '/api/google/conectar' && metodo === 'GET') {
          exigir(identidade.papeis, 'integracao.gerir');
          return json(await banco.comoUsuario(identidade.usuarioId, db => google.conectar(db, identidade)));
        }
        if (rota === '/api/google/finalizar' && metodo === 'GET') {
          exigir(identidade.papeis, 'integracao.gerir');
          if (!url.searchParams.get('code') || !url.searchParams.get('state')) return erro('Autorização Google recusada ou incompleta.', 400);
          await banco.comoUsuario(identidade.usuarioId, db => google.callback(db, identidade, url.searchParams.get('code')!, url.searchParams.get('state')!));
          return new Response(null,{status:303,headers:{location:'/#/ajustes'}});
        }
        if (rota === '/api/google/eventos' && metodo === 'GET') {
          const id=url.searchParams.get('projetoId');
          if(id && !z.string().uuid().safeParse(id).success) return erro('Projeto inválido.',400);
          return json(await banco.comoUsuario(identidade.usuarioId,db=>google.listarEventos(db,id??undefined)));
        }
        if (rota === '/api/google/eventos' && metodo === 'POST') {
          exigir(identidade.papeis,'tarefa.escrever');
          const d=google.EsquemaEvento.safeParse(await req.json().catch(()=>null));
          if(!d.success)return erro('Evento inválido.',400,d.error.issues);
          return json(await banco.comoUsuario(identidade.usuarioId,db=>google.criarEvento(db,identidade,d.data)),201);
        }
        const drive=/^\/api\/google\/projetos\/([0-9a-f-]{36})\/(drive|documentos)$/.exec(rota);
        if(drive && metodo==='POST') {
          exigir(identidade.papeis,'integracao.gerir');
          return json(await banco.comoUsuario(identidade.usuarioId,db=>drive[2]==='drive'?google.criarPastas(db,drive[1]!):google.sincronizarDocumentos(db,drive[1]!,deposito.armazenamento)));
        }
      }

      // ------------------------------------------------ administração da equipe / visão do projeto ---
      if(rota==='/api/escritorio/gestao-equipe' && ['GET','POST'].includes(metodo)) {
        exigir(identidade.papeis,'admin.gerir');
        if(metodo==='GET') return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.listar(db,identidade)));
        const d=equipeAdmin.EsquemaPessoa.safeParse(await req.json().catch(()=>null));
        if(!d.success)return erro('dados inválidos',400,d.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.convidar(db,d.data,identidade)),201);
      }
      const mPessoa=/^\/api\/escritorio\/gestao-equipe\/([0-9a-f-]{36})(?:\/(redefinir-senha))?$/.exec(rota);
      if(mPessoa && ['POST','PATCH'].includes(metodo)) {
        exigir(identidade.papeis,'admin.gerir');
        if(mPessoa[2] && metodo==='POST') return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.gerarLink(db,mPessoa[1]!,identidade)));
        if(!mPessoa[2] && metodo==='PATCH') {
          const d=equipeAdmin.EsquemaAcesso.safeParse(await req.json().catch(()=>null));if(!d.success)return erro('dados inválidos',400,d.error.issues);
          return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.acesso(db,mPessoa[1]!,d.data,identidade)));
        }
      }
      const mVisao=/^\/api\/projetos\/([0-9a-f-]{36})\/(visao|marcos)$/.exec(rota);
      if(mVisao && metodo==='GET' && mVisao[2]==='visao') {
        exigir(identidade.papeis,'projeto.ler');return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.visao(db,mVisao[1]!)));
      }
      if(mVisao && metodo==='POST' && mVisao[2]==='marcos') {
        exigir(identidade.papeis,'projeto.escrever');const d=equipeAdmin.EsquemaMarco.safeParse(await req.json().catch(()=>null));if(!d.success)return erro('dados inválidos',400,d.error.issues);
        if(d.data.visivelCliente) exigir(identidade.papeis,'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.criarMarco(db,mVisao[1]!,d.data,identidade)),201);
      }
      const mMarco=/^\/api\/projeto-marcos\/([0-9a-f-]{36})$/.exec(rota);
      if(mMarco && metodo==='PATCH') {
        exigir(identidade.papeis,'projeto.escrever');const d=equipeAdmin.EsquemaAtualizarMarco.safeParse(await req.json().catch(()=>null));if(!d.success)return erro('dados inválidos',400,d.error.issues);
        if(d.data.visivelCliente) exigir(identidade.papeis,'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId,db=>equipeAdmin.atualizarMarco(db,mMarco[1]!,d.data,identidade)));
      }

      // --------------------------------------------------- integrações ---

      if (rota === '/api/integracoes' && metodo === 'GET') {
        exigir(identidade.papeis, 'integracao.gerir');
        return json({
          integracoes: await banco.comoUsuario(identidade.usuarioId, integracoes.listar),
          contrato: integracoes.contrato(),
        });
      }
      if (rota === '/api/integracoes' && metodo === 'POST') {
        // Criar credencial é dar chave de porta: fica com quem administra.
        exigir(identidade.papeis, 'integracao.gerir');
        const corpo = integracoes.EsquemaNovaIntegracao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          integracoes.criar(db, corpo.data, identidade)), 201);
      }
      const mIntegracao = /^\/api\/integracoes\/([0-9a-f-]{36})$/.exec(rota);
      if (mIntegracao && metodo === 'DELETE') {
        exigir(identidade.papeis, 'integracao.gerir');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          integracoes.revogar(db, mIntegracao[1]!, identidade)));
      }

      // ------------------------------------------ customizable office/project playbooks ---
      if ((rota === '/api/playbooks' || rota === '/api/admin/playbooks') && metodo === 'GET') {
        exigir(identidade.papeis, rota.includes('/admin/') ? 'admin.gerir' : 'tarefa.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, playbookConfig.listarModelos));
      }
      if (rota === '/api/admin/playbooks/importar-padroes' && metodo === 'POST') {
        exigir(identidade.papeis, 'admin.gerir');
        return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.importarPadroes(db,identidade)),201);
      }
      if (rota === '/api/admin/playbooks' && metodo === 'POST') {
        exigir(identidade.papeis,'admin.gerir');
        const v=playbookConfig.EsquemaModelo.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.criarModelo(db,v.data,identidade)),201);
      }
      const mModeloConfig=/^\/api\/admin\/playbooks\/([0-9a-f-]{36})(\/nos)?$/.exec(rota);
      if(mModeloConfig){
        exigir(identidade.papeis,'admin.gerir');const id=mModeloConfig[1]!;
        if(metodo==='GET'&&!mModeloConfig[2])return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.lerModelo(db,id)));
        if(metodo==='PATCH'&&!mModeloConfig[2]){const v=playbookConfig.EsquemaModeloPatch.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.editarModelo(db,id,v.data,identidade)));}
        if(metodo==='POST'&&mModeloConfig[2]){const v=playbookConfig.EsquemaNo.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.criarNo(db,'modelo',id,v.data,identidade)),201);}
      }
      const mNoConfig=/^\/api\/playbook-nos\/([0-9a-f-]{36})$/.exec(rota);
      if(mNoConfig&&['PATCH','DELETE'].includes(metodo)){
        exigir(identidade.papeis,'projeto.escrever');const id=mNoConfig[1]!;
        return json(await banco.comoUsuario(identidade.usuarioId,async db=>{const r=await db.query('SELECT modelo_id FROM playbook_nos WHERE id=$1',[id]);if(!r.rows[0])throw new NaoEncontrado('nó não encontrado');if(r.rows[0].modelo_id)exigir(identidade.papeis,'admin.gerir');if(metodo==='DELETE')return playbookConfig.arquivarNo(db,id,identidade);const v=playbookConfig.EsquemaNoPatch.safeParse(await req.json().catch(()=>null));if(!v.success)throw new PedidoInvalido('dados do nó inválidos');return playbookConfig.editarNo(db,id,v.data,identidade);}));
      }
      const mFluxoConfig=/^\/api\/projetos\/([0-9a-f-]{36})\/fluxo(?:\/(aplicar|nos|fase|gerar))?$/.exec(rota);
      if(mFluxoConfig){
        exigir(identidade.papeis,metodo==='GET'?'tarefa.ler':'projeto.escrever');const id=mFluxoConfig[1]!,acao=mFluxoConfig[2];
        if(metodo==='GET'&&!acao)return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.lerFluxo(db,id)));
        if(metodo==='POST'&&acao==='aplicar'){const v=playbookConfig.EsquemaAplicar.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.aplicarModelo(db,id,v.data.modeloId,identidade,v.data.gerarTarefas)));}
        if(metodo==='POST'&&acao==='nos'){const v=playbookConfig.EsquemaNo.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.criarNo(db,'projeto',id,v.data,identidade)),201);}
        if(metodo==='POST'&&acao==='fase'){const v=playbookConfig.EsquemaMoverFase.safeParse(await req.json().catch(()=>null));if(!v.success)return erro('dados inválidos',400,v.error.issues);return json(await banco.comoUsuario(identidade.usuarioId,db=>playbookConfig.moverFase(db,id,v.data.noId,identidade)));}
        if(metodo==='POST'&&acao==='gerar')return json(await banco.comoUsuario(identidade.usuarioId,async db=>({criadas:await playbookConfig.gerarTarefas(db,id,'manual',id,identidade)})));
      }

      // --------------------------------------------------------- tarefas ---

      if (rota === '/api/tarefas' && metodo === 'GET') {
        exigir(identidade.papeis, 'tarefa.ler');
        const filtros: tarefas.Filtros = {
          ...(url.searchParams.get('projeto') ? { projetoId: url.searchParams.get('projeto')! } : {}),
          ...(url.searchParams.get('minhas') === '1' ? { responsavelId: identidade.usuarioId } : {}),
          incluirConcluidas: url.searchParams.get('concluidas') === '1',
        };
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => tarefas.listar(db, filtros)));
      }

      const mTarefasDoProjeto = /^\/api\/projetos\/([0-9a-f-]{36})\/tarefas$/.exec(rota);
      if (mTarefasDoProjeto && metodo === 'POST') {
        exigir(identidade.papeis, 'tarefa.escrever');
        const corpo = tarefas.EsquemaTarefa.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          tarefas.criar(db, mTarefasDoProjeto[1]!, corpo.data, identidade)), 201);
      }

      const mConfig = /^\/api\/projetos\/([0-9a-f-]{36})\/(automacoes|playbook\/notas|pesquisa)$/.exec(rota);
      if (mConfig) {
        exigir(identidade.papeis, metodo === 'GET' ? 'tarefa.ler' : 'projeto.escrever');
        const pid = mConfig[1]!; const recurso = mConfig[2]!;
        if (metodo === 'GET') return json(await banco.comoUsuario(identidade.usuarioId, async (db): Promise<unknown> =>
          recurso === 'automacoes' ? projetoConfig.automacoes(db,pid) : recurso === 'pesquisa' ? projetoConfig.pesquisar(db,pid,url.searchParams.get('q') ?? '') : projetoConfig.notas(db,pid)));
        if (recurso === 'automacoes' && metodo === 'POST') {
          const corpo = projetoConfig.EsquemaAutomacao.safeParse(await req.json().catch(() => null));
          if (!corpo.success) return erro('dados inválidos',400,corpo.error.issues);
          return json(await banco.comoUsuario(identidade.usuarioId,(db)=>projetoConfig.criarAutomacao(db,pid,corpo.data,identidade)),201);
        }
        if (recurso === 'playbook/notas' && metodo === 'PUT') {
          const corpo = projetoConfig.EsquemaNota.safeParse(await req.json().catch(() => null));
          if (!corpo.success) return erro('dados inválidos',400,corpo.error.issues);
          return json(await banco.comoUsuario(identidade.usuarioId,(db)=>projetoConfig.salvarNota(db,pid,corpo.data,identidade)));
        }
      }
      const mAutomacao = /^\/api\/automacoes\/([0-9a-f-]{36})$/.exec(rota);
      if (mAutomacao && ['PATCH','DELETE'].includes(metodo)) {
        exigir(identidade.papeis,'projeto.escrever');
        if (metodo === 'DELETE') return json(await banco.comoUsuario(identidade.usuarioId,(db)=>projetoConfig.excluirAutomacao(db,mAutomacao[1]!,identidade)));
        const corpo = projetoConfig.EsquemaAtualizarAutomacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos',400,corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId,(db)=>projetoConfig.atualizarAutomacao(db,mAutomacao[1]!,corpo.data,identidade)));
      }

      // ------------------------------------------------------ negociações ---
      const mNegDoProjeto = /^\/api\/projetos\/([0-9a-f-]{36})\/negociacoes$/.exec(rota);
      if (mNegDoProjeto && metodo === 'GET') {
        exigir(identidade.papeis, 'negociacao.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => negociacoes.listar(db, mNegDoProjeto[1]!)));
      }
      if (mNegDoProjeto && metodo === 'POST') {
        exigir(identidade.papeis, 'negociacao.escrever');
        const corpo = negociacoes.EsquemaNegociacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        // Mostrar ao cliente é publicar: mesma permissão do resto do que sai para o portal.
        if (corpo.data.visivelAoCliente) exigir(identidade.papeis, 'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          negociacoes.criar(db, mNegDoProjeto[1]!, corpo.data, identidade)), 201);
      }
      const mNeg = /^\/api\/negociacoes\/([0-9a-f-]{36})$/.exec(rota);
      if (mNeg && metodo === 'PATCH') {
        exigir(identidade.papeis, 'negociacao.escrever');
        const corpo = negociacoes.EsquemaAtualizacaoNegociacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        if (corpo.data.visivelAoCliente !== undefined || corpo.data.resumoCliente !== undefined) exigir(identidade.papeis, 'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => negociacoes.atualizar(db, mNeg[1]!, corpo.data, identidade)));
      }
      if (mNeg && metodo === 'DELETE') {
        exigir(identidade.papeis, 'negociacao.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => negociacoes.excluir(db, mNeg[1]!, identidade)));
      }
      const mNegCliente = /^\/api\/portal\/projetos\/([0-9a-f-]{36})\/negociacoes$/.exec(rota);
      if (mNegCliente && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => negociacoes.doCliente(db, mNegCliente[1]!)));
      }

      // ------------------------------------------------------ controladoria ---
      // Só sócio administrador e controladoria (permissões controladoria.*). Nenhum outro papel chega aqui.
      if (rota === '/api/controladoria/prazos-astrea' && metodo === 'GET') {
        exigir(identidade.papeis, 'controladoria.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, controladoria.listarPrazosAstreaPendentes));
      }
      const mPrazoAstrea = /^\/api\/controladoria\/prazos-astrea\/([0-9a-f-]{36})\/vinculo$/.exec(rota);
      if (mPrazoAstrea && metodo === 'POST') {
        exigir(identidade.papeis, 'controladoria.gerir');
        exigir(identidade.papeis, 'processo.escrever');
        exigir(identidade.papeis, 'prazo.escrever');
        const d = controladoria.EsquemaVinculoPrazoAstrea.safeParse(await req.json().catch(() => null));
        if (!d.success) return erro('Escolha um projeto e informe se o novo processo corre em segredo de justiça.', 400, d.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          controladoria.vincularPrazosAstrea(db, mPrazoAstrea[1]!, d.data, identidade)));
      }
      if (rota === '/api/controladoria/oabs' && metodo === 'GET') {
        exigir(identidade.papeis, 'controladoria.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, controladoria.listarOabs));
      }
      if (rota === '/api/controladoria/oabs' && metodo === 'POST') {
        exigir(identidade.papeis, 'controladoria.gerir');
        const corpo = controladoria.EsquemaOab.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => controladoria.cadastrarOab(db, corpo.data, identidade)), 201);
      }
      const mOab = /^\/api\/controladoria\/oabs\/([0-9a-f-]{36})$/.exec(rota);
      if (mOab && metodo === 'PATCH') {
        exigir(identidade.papeis, 'controladoria.gerir');
        const corpo = z.object({ ativo: z.boolean() }).safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => controladoria.alternarOab(db, mOab[1]!, corpo.data.ativo, identidade)));
      }
      if (rota === '/api/controladoria/sincronizacao' && metodo === 'POST') {
        exigir(identidade.papeis, 'controladoria.gerir');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => controladoria.sincronizar(db, identidade, ctx.buscadorDjen ?? controladoria.buscarNoDjen, ctx.buscadorDjen ? 0 : 700)));
      }
      if (rota === '/api/controladoria/publicacoes' && metodo === 'GET') {
        exigir(identidade.papeis, 'controladoria.ler');
        const p = url.searchParams;
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => controladoria.listarPublicacoes(db, {
          ...(url.searchParams.get('inicio') ? {inicio:url.searchParams.get('inicio')!}:{}),
          ...(url.searchParams.get('fim') ? {fim:url.searchParams.get('fim')!}:{}),
          ...(url.searchParams.get('periodo') ? {periodo:url.searchParams.get('periodo')!}:{}),
          ...(p.get('situacao') ? { situacao: p.get('situacao')! } : {}), ...(p.get('oab') ? { oab: p.get('oab')! } : {}),
          ...(p.get('q') ? { q: p.get('q')! } : {}), pagina: Number(p.get('pagina') ?? 1) || 1 })));
      }
      const mPubVinculo=/^\/api\/controladoria\/publicacoes\/([0-9a-f-]{36})\/vinculo$/.exec(rota);
      if(mPubVinculo&&metodo==='POST'){
        exigir(identidade.papeis,'controladoria.gerir');exigir(identidade.papeis,'processo.escrever');
        const d=controladoria.EsquemaVinculoPublicacao.safeParse(await req.json().catch(()=>null));if(!d.success)return erro('Escolha um projeto válido.',400,d.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId,db=>controladoria.vincularProjetoDaPublicacao(db,mPubVinculo[1]!,d.data.projetoId,identidade)));
      }
      const mPubAnalise=/^\/api\/controladoria\/publicacoes\/([0-9a-f-]{36})\/(detalhe|analise)$/.exec(rota);
      if(mPubAnalise && ((mPubAnalise[2]==='detalhe'&&metodo==='GET')||(mPubAnalise[2]==='analise'&&metodo==='POST'))) {
        exigir(identidade.papeis,'controladoria.ler');
        const p=await banco.comoUsuario(identidade.usuarioId,db=>controladoria.detalharPublicacao(db,mPubAnalise[1]!));
        if(mPubAnalise[2]==='detalhe')return json(p);
        const data=p.data_disponibilizacao instanceof Date?p.data_disponibilizacao.toISOString().slice(0,10):String(p.data_disponibilizacao).slice(0,10);
        return json(await sugerirPrazo(p.texto_legivel,data));
      }
      const mPubAgenda=/^\/api\/controladoria\/publicacoes\/([0-9a-f-]{36})\/agendamento$/.exec(rota);
      if(mPubAgenda && metodo==='POST') {
        exigir(identidade.papeis,'controladoria.gerir'); exigir(identidade.papeis,'prazo.escrever');
        const d=controladoria.EsquemaAgendamento.safeParse(await req.json().catch(()=>null));
        if(!d.success)return erro('Agendamento inválido.',400,d.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId,db=>controladoria.agendarPublicacao(db,mPubAgenda[1]!,d.data,identidade)),201);
      }
      const mPub = /^\/api\/controladoria\/publicacoes\/([0-9a-f-]{36})$/.exec(rota);
      if (mPub && metodo === 'PATCH') {
        exigir(identidade.papeis, 'controladoria.gerir');
        const corpo = controladoria.EsquemaPublicacaoAtualizacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => controladoria.atualizarPublicacao(db, mPub[1]!, corpo.data, identidade)));
      }

      const mTarefa = /^\/api\/tarefas\/([0-9a-f-]{36})$/.exec(rota);
      if (mTarefa && (metodo === 'PATCH' || metodo === 'DELETE')) {
        exigir(identidade.papeis, 'tarefa.escrever');
        if (metodo === 'DELETE') {
          return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
            tarefas.excluir(db, mTarefa[1]!, identidade)));
        }
        const corpo = tarefas.EsquemaAtualizacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          tarefas.atualizar(db, mTarefa[1]!, corpo.data, identidade)));
      }

      if (rota === '/api/escritorio/equipe' && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, tarefas.equipeDoEscritorio));
      }

      // ---------------------------------------------------- ferramentas ---
      // O estado vem de uma sondagem de verdade a cada aplicação do Lab.
      if (rota === '/api/ferramentas' && metodo === 'GET') {
        if (ehCliente) return erro('acesso negado', 403);
        exigir(identidade.papeis, 'projeto.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, ferramentas.estado));
      }

      const toolAccess=/^\/api\/ferramentas\/(prazos|sentinela)\/(acesso|confirmar)$/.exec(rota);
      if(toolAccess){
        if(ehCliente)return erro('Acesso negado.',403);exigir(identidade.papeis,'projeto.ler');
        const tool=toolAccess[1] as ferramentaSso.FerramentaSso;
        if(toolAccess[2]==='acesso'&&metodo==='POST')return json(await banco.comoUsuario(identidade.usuarioId,db=>ferramentaSso.emitirAcessoSso(db,identidade,tool)));
        if(toolAccess[2]==='confirmar'&&metodo==='GET'){
          const target=await banco.comoUsuario(identidade.usuarioId,db=>ferramentaSso.autorizarAcessoSso(db,identidade,tool,url.searchParams.get('ticket')??'',url.searchParams.get('state')??''));
          return new Response(null,{status:303,headers:{location:target,'cache-control':'no-store','referrer-policy':'no-referrer'}});
        }
      }

      // --------------------------------------------------------- credores ---
      const mCredor = /^\/api\/projetos\/([0-9a-f-]{36})\/credores$/.exec(rota);
      if (mCredor && metodo === 'POST') {
        exigir(identidade.papeis, 'credito.escrever');
        const corpo = EsquemaCredor.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          criarCredor(db, mCredor[1]!, corpo.data, identidade)), 201);
      }
      if (mCredor && metodo === 'GET') {
        exigir(identidade.papeis, 'credito.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, async (db) => {
          const { rows } = await db.query(
            'SELECT id, nome, documento, me_epp FROM credores WHERE projeto_id = $1 ORDER BY nome',
            [mCredor[1]!]);
          return rows;
        }));
      }

      // ----------------------------------------------------- portal (equipe) ---
      const mPortal = /^\/api\/projetos\/([0-9a-f-]{36})\/portal$/.exec(rota);
      if (mPortal && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        if (ehCliente) return erro('acesso negado', 403);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          convites.portalDoProjeto(db, mPortal[1]!)));
      }
      if (mPortal && metodo === 'PATCH') {
        exigir(identidade.papeis, 'portal.publicar');
        const corpo = convites.EsquemaPortal.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          convites.ajustarPortal(db, mPortal[1]!, corpo.data, identidade)));
      }
      const mConvite = /^\/api\/projetos\/([0-9a-f-]{36})\/portal\/convites$/.exec(rota);
      if (mConvite && metodo === 'POST') {
        // Dar acesso a cliente é dar chave de porta: mesma permissão de publicar.
        exigir(identidade.papeis, 'portal.publicar');
        const corpo = convites.EsquemaConvite.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          convites.convidar(db, mConvite[1]!, corpo.data, identidade)), 201);
      }

      // ------------------------------------------------------- projetos ---
      // O projeto é a espinha: crédito, plano, assembleia, portal, checklist,
      // documento, análise, processo e relatório se penduram nele. O `hub`
      // é onde isso tudo aparece junto.

      if (rota === '/api/atividade' && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        if (ehCliente) return erro('acesso negado', 403);
        const desde = url.searchParams.get('desde');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          atividade(db, desde && !Number.isNaN(Date.parse(desde)) ? desde : null)));
      }

      if (rota === '/api/painel' && metodo === 'GET') {
        // O painel do cliente é o portal; este é o de quem trabalha no caso.
        if (ehCliente) return erro('use /api/portal/projetos', 403);
        exigir(identidade.papeis, 'projeto.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.painel(db, identidade)));
      }

      if (rota === '/api/projetos/fases' && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        return json(projetos.catalogoDeFases());
      }

      if (rota === '/api/projetos' && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        const lista = await banco.comoUsuario(identidade.usuarioId, projetos.listar);
        // A prioridade é decisão de gestão do escritório; o cliente não a recebe.
        return json(ehCliente ? lista.map(({ prioridade: _p, ...resto }) => resto) : lista);
      }

      if (rota === '/api/projetos' && metodo === 'POST') {
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = projetos.EsquemaProjeto.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.criar(db, corpo.data, identidade)), 201);
      }

      const mProjeto = /^\/api\/projetos\/([0-9a-f-]{36})$/.exec(rota);
      if (mProjeto && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        const hub = await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.hub(db, mProjeto[1]!));
        return json(ehCliente ? (({ prioridade: _p, ...resto }) => resto)(hub) : hub);
      }

      const mFase = /^\/api\/projetos\/([0-9a-f-]{36})\/fase$/.exec(rota);
      if (mFase && metodo === 'POST') {
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = projetos.EsquemaFase.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.mudarFase(db, mFase[1]!, corpo.data, identidade)));
      }

      // ------------------------------------------- relatórios do gerador ---
      const mGerador = /^\/api\/projetos\/([0-9a-f-]{36})\/gerador\/emissoes$/.exec(rota);
      if (mGerador && metodo === 'GET') {
        exigir(identidade.papeis, 'relatorio.gerar');
        if (ehCliente) return erro('acesso negado', 403);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => gerador.emissoes(db, mGerador[1]!)));
      }
      const mImportar = /^\/api\/projetos\/([0-9a-f-]{36})\/gerador\/importacoes$/.exec(rota);
      if (mImportar && metodo === 'POST') {
        exigir(identidade.papeis, 'relatorio.gerar');
        const corpo = z.object({ emissaoId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), publicar: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        if (corpo.data.publicar) exigir(identidade.papeis, 'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId, async (db) => {
          const r = await gerador.importar(db, mImportar[1]!, corpo.data.emissaoId, identidade, deposito);
          if (corpo.data.publicar) await portal.publicarDocumento(db, r.documentoId, identidade);
          return { ...r, publicado: !!corpo.data.publicar };
        }), 201);
      }

      const mPlaybook = /^\/api\/projetos\/([0-9a-f-]{36})\/playbook$/.exec(rota);
      if (mPlaybook && metodo === 'POST') {
        // Aplica o playbook da fase atual (e o de abertura) num projeto que já existe. Idempotente.
        exigir(identidade.papeis, 'projeto.escrever');
        exigir(identidade.papeis, 'tarefa.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, async (db) => {
          const { rows } = await db.query<{ organizacao_id: string; tipo: TipoDeProjeto; fase: string | null }>(
            'SELECT organizacao_id, tipo, fase FROM projetos WHERE id = $1', [mPlaybook[1]!]);
          const p = rows[0]; if (!p) throw new NaoEncontrado('projeto não encontrado');
          return projetos.aplicarPlaybook(db, mPlaybook[1]!, p.organizacao_id, p.tipo, p.fase ?? faseInicial(p.tipo).id, identidade, true);
        }));
      }

      const mEncerrar = /^\/api\/projetos\/([0-9a-f-]{36})\/encerramento$/.exec(rota);
      if (mEncerrar && metodo === 'POST') {
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = projetos.EsquemaEncerramento.safeParse(await req.json().catch(() => null));
        if (!corpo.success) {
          return erro('encerrar exige motivo com ao menos 5 caracteres', 400, corpo.error.issues);
        }
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.encerrar(db, mEncerrar[1]!, corpo.data, identidade)));
      }

      const mEquipe = /^\/api\/projetos\/([0-9a-f-]{36})\/equipe$/.exec(rota);
      if (mEquipe && metodo === 'POST') {
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = projetos.EsquemaEquipe.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.entrarNaEquipe(db, mEquipe[1]!, corpo.data, identidade)), 201);
      }

      const mSair = /^\/api\/equipe\/([0-9a-f-]{36})$/.exec(rota);
      if (mSair && metodo === 'DELETE') {
        exigir(identidade.papeis, 'projeto.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          projetos.sairDaEquipe(db, mSair[1]!, identidade)));
      }

      // --------------------------------------------------------- créditos ---
      const mCreditos = /^\/api\/projetos\/([0-9a-f-]{36})\/creditos$/.exec(rota);
      if (mCreditos && metodo === 'GET') {
        exigir(identidade.papeis, 'credito.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, async (db) =>
          listarCreditos(db, mCreditos[1]!)));
      }

      if (mCreditos && metodo === 'POST') {
        exigir(identidade.papeis, 'credito.escrever');
        const corpo = EsquemaCredito.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          criarCredito(db, mCreditos[1]!, corpo.data, identidade)), 201);
      }

      const mValidar = /^\/api\/creditos\/([0-9a-f-]{36})\/validar$/.exec(rota);
      if (mValidar && metodo === 'POST') {
        // Validar enquadramento é ato jurídico; o §7.7 exige revisão humana
        // qualificada e é aqui que ela se materializa.
        exigir(identidade.papeis, 'credito.validar');
        const corpo = EsquemaValidacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          validarCredito(db, mValidar[1]!, corpo.data, identidade)));
      }

      // -------------------------------------------------------------- AGC ---
      const mApuracao = /^\/api\/assembleias\/([0-9a-f-]{36})\/apuracao$/.exec(rota);
      if (mApuracao && metodo === 'GET') {
        exigir(identidade.papeis, 'agc.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          apurar(db, mApuracao[1]!)));
      }
      if (mApuracao && metodo === 'POST') {
        exigir(identidade.papeis, 'agc.apurar');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          registrarApuracao(db, mApuracao[1]!, identidade)), 201);
      }

      // ----------------------------------------------------------- portal ---
      // O cliente entra por aqui. O RLS da migração 009 é que decide o que ele
      // alcança; estas rotas não refazem o filtro.

      if (rota === '/api/portal/projetos' && metodo === 'GET') {
        return json(await banco.comoUsuario(identidade.usuarioId, portal.meusPortais));
      }

      const mChecklist = /^\/api\/projetos\/([0-9a-f-]{36})\/checklist$/.exec(rota);
      if (mChecklist && metodo === 'GET') {
        exigir(identidade.papeis, 'documento.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.checklist(db, mChecklist[1]!)));
      }
      if (mChecklist && metodo === 'POST') {
        // Gerar o checklist a partir do modelo do procedimento é ato da NGA.
        exigir(identidade.papeis, 'documento.escrever');
        exigir(identidade.papeis, 'projeto.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.aplicarModelo(db, mChecklist[1]!, identidade)), 201);
      }

      const mEnvio = /^\/api\/projetos\/([0-9a-f-]{36})\/documentos$/.exec(rota);
      if (mEnvio && metodo === 'GET') {
        exigir(identidade.papeis, 'documento.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.documentos(db, mEnvio[1]!)));
      }
      if (mEnvio && metodo === 'POST') {
        exigir(identidade.papeis, 'documento.escrever');
        const projetoId = mEnvio[1]!;

        // Duas formas de o documento nascer, e a resposta diz qual foi. Enviar
        // arquivo é o caminho normal; registrar referência serve ao que está
        // no arquivo físico e não foi digitalizado.
        if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
          const formulario = await req.formData().catch(() => null);
          if (!formulario) return erro('formulário inválido', 400);
          const arquivo = formulario.get('arquivo');
          if (!(arquivo instanceof File)) return erro('campo "arquivo" ausente', 400);

          const meta = arquivos.EsquemaMetadados.safeParse({
            titulo: formulario.get('titulo') ?? arquivo.name,
            categoria: formulario.get('categoria') ?? undefined,
            requisitoId: formulario.get('requisitoId') ?? undefined,
          });
          if (!meta.success) return erro('dados inválidos', 400, meta.error.issues);

          const guardado = await banco.comoUsuario(identidade.usuarioId, async (db) => {
            const recebido = await arquivos.receber(
              db, projetoId, arquivo, meta.data, identidade, deposito,
              ehCliente ? 'portal_cliente' : 'interno');
            if (!meta.data.requisitoId) return { ...recebido, temArquivo: true };
            const vinculo = await portal.vincularAoRequisito(
              db, meta.data.requisitoId, recebido.documentoId, identidade,
              ehCliente ? 'cliente' : 'nga');
            return { ...recebido, ...vinculo, temArquivo: true };
          });
          agendarAnalise(guardado.documentoId);
          return json(guardado, 201);
        }

        const corpo = portal.EsquemaEnvio.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json({
          ...await banco.comoUsuario(identidade.usuarioId, (db) =>
            portal.enviarDocumento(db, projetoId, corpo.data, identidade,
              ehCliente ? 'cliente' : 'nga')),
          temArquivo: false,
        }, 201);
      }

      const mVinculo = /^\/api\/requisitos\/([0-9a-f-]{36})\/vinculo$/.exec(rota);
      if (mVinculo && metodo === 'POST') {
        // Organizar o que o cliente mandou solto é ato da NGA: o sistema sugere, a pessoa vincula.
        exigir(identidade.papeis, 'documento.escrever');
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = z.object({ documentoId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.vincularAoRequisito(db, mVinculo[1]!, corpo.data.documentoId, identidade, 'nga')));
      }

      const mAnalise = /^\/api\/requisitos\/([0-9a-f-]{36})\/analise$/.exec(rota);
      if (mAnalise && metodo === 'POST') {
        // Aprovar documento de cliente é ato da NGA; a máquina de situações do
        // domínio recusa a transição mesmo que o RBAC um dia seja afrouxado.
        exigir(identidade.papeis, 'documento.escrever');
        exigir(identidade.papeis, 'projeto.escrever');
        const corpo = portal.EsquemaAnalise.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.analisarRequisito(db, mAnalise[1]!, corpo.data, identidade)));
      }

      const mPublicar = /^\/api\/documentos\/([0-9a-f-]{36})\/publicacao$/.exec(rota);
      if (mPublicar && (metodo === 'POST' || metodo === 'DELETE')) {
        // Única porta de saída de documento para fora do ambiente interno (§13).
        exigir(identidade.papeis, 'portal.publicar');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          metodo === 'POST'
            ? portal.publicarDocumento(db, mPublicar[1]!, identidade)
            : portal.despublicarDocumento(db, mPublicar[1]!, identidade)));
      }

      const mObrigacoes = /^\/api\/projetos\/([0-9a-f-]{36})\/obrigacoes$/.exec(rota);
      if (mObrigacoes && metodo === 'GET') {
        exigir(identidade.papeis, 'plano.ler');
        const hoje = new Date().toISOString().slice(0, 10);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.obrigacoes(db, mObrigacoes[1]!, hoje)));
      }

      const mFinanceiro = /^\/api\/projetos\/([0-9a-f-]{36})\/financeiro$/.exec(rota);
      if (mFinanceiro && metodo === 'GET') {
        exigir(identidade.papeis, 'financeiro_cliente.ler');
        const hoje = new Date();
        const de = url.searchParams.get('de')
          ?? new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1).toISOString().slice(0, 10);
        const ate = url.searchParams.get('ate')
          ?? new Date(hoje.getFullYear(), hoje.getMonth() + 6, 0).toISOString().slice(0, 10);
        const gran = (url.searchParams.get('granularidade') ?? 'mensal') as 'diaria'|'semanal'|'mensal';
        if (!['diaria', 'semanal', 'mensal'].includes(gran)) return erro('granularidade inválida', 400);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.financeiro(db, mFinanceiro[1]!, de, ate, gran)));
      }
      if (mFinanceiro && metodo === 'POST') {
        exigir(identidade.papeis, 'financeiro_cliente.escrever');
        const corpo = portal.EsquemaLancamento.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.lancar(db, mFinanceiro[1]!, corpo.data, identidade)), 201);
      }

      const mMensagens = /^\/api\/projetos\/([0-9a-f-]{36})\/mensagens$/.exec(rota);
      if (mMensagens && metodo === 'GET') {
        exigir(identidade.papeis, 'projeto.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.mensagens(db, mMensagens[1]!)));
      }
      if (mMensagens && metodo === 'POST') {
        exigir(identidade.papeis, 'projeto.ler');
        const corpo = portal.EsquemaMensagem.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        // O lado vem do PAPEL do usuário, nunca do corpo da requisição: assim
        // ninguém se faz passar pelo outro lado.
        const lado = identidade.organizacoes.some((o) => o.tipo === 'escritorio') ? 'nga' : 'cliente';
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          portal.enviarMensagem(db, mMensagens[1]!, lado, corpo.data, identidade)), 201);
      }

      // ------------------------------------------------------ processos ---
      // As mesmas rotas servem à equipe e ao cliente: quem separa o que cada
      // um vê é o RLS da migração 014, não um `if` aqui. O cliente alcança o
      // processo do projeto dele, as partes e as movimentações PUBLICADAS —
      // e prazo nenhum, por caminho nenhum.

      const hojeISO = new Date().toISOString().slice(0, 10);

      if (rota === '/api/processos' && metodo === 'GET') {
        exigir(identidade.papeis, 'processo.ler');
        const projetoId = url.searchParams.get('projeto');
        if (projetoId !== null && !z.string().uuid().safeParse(projetoId).success) return erro('projeto inválido', 400);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.listar(db, hojeISO, projetoId ?? undefined)));
      }
      if (rota === '/api/processos' && metodo === 'POST') {
        exigir(identidade.papeis, 'processo.escrever');
        const corpo = processos.EsquemaProcesso.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.criar(db, corpo.data, identidade)), 201);
      }

      if (rota === '/api/prazos/catalogo' && metodo === 'GET') {
        exigir(identidade.papeis, 'prazo.ler');
        return json(PRAZOS_USUAIS);
      }

      if (rota === '/api/calendario/feriados' && metodo === 'GET') {
        exigir(identidade.papeis, 'prazo.ler');
        const ano = Number(url.searchParams.get('ano') ?? new Date().getFullYear());
        if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return erro('ano inválido', 400);
        // Só o NACIONAL e o recesso: feriado local e suspensão do tribunal o sistema não conhece.
        return json({
          ano, feriados: calendarioNacional(ano),
          recesso: { de: `${ano}-12-20`, ate: `${ano + 1}-01-20`, fundamento: 'art. 220 do CPC' },
          ressalva: 'Feriados estaduais e municipais e suspensões do tribunal não estão aqui.',
          noRecessoHoje: noRecesso(new Date().toISOString().slice(0, 10)),
        });
      }

      if (rota === '/api/agenda' && metodo === 'GET') {
        exigir(identidade.papeis, 'prazo.ler');
        const ate = url.searchParams.get('ate')
          ?? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.agenda(db, hojeISO, ate)));
      }

      const mProcesso = /^\/api\/processos\/([0-9a-f-]{36})$/.exec(rota);
      if (mProcesso && metodo === 'GET') {
        exigir(identidade.papeis, 'processo.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.detalhe(db, mProcesso[1]!, hojeISO)));
      }

      const mSituacao = /^\/api\/processos\/([0-9a-f-]{36})\/situacao$/.exec(rota);
      if (mSituacao && metodo === 'POST') {
        exigir(identidade.papeis, 'processo.escrever');
        const corpo = processos.EsquemaSituacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.mudarSituacao(db, mSituacao[1]!, corpo.data, identidade)));
      }

      const mPartes = /^\/api\/processos\/([0-9a-f-]{36})\/partes$/.exec(rota);
      if (mPartes && metodo === 'POST') {
        exigir(identidade.papeis, 'processo.escrever');
        const corpo = processos.EsquemaParte.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.adicionarParte(db, mPartes[1]!, corpo.data, identidade)), 201);
      }

      const mMovs = /^\/api\/processos\/([0-9a-f-]{36})\/movimentacoes$/.exec(rota);
      if (mMovs && metodo === 'POST') {
        exigir(identidade.papeis, 'processo.escrever');
        const corpo = processos.EsquemaMovimentacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.registrarMovimentacao(db, mMovs[1]!, corpo.data, identidade)), 201);
      }

      const mPublicarMov = /^\/api\/movimentacoes\/([0-9a-f-]{36})\/publicacao$/.exec(rota);
      if (mPublicarMov && (metodo === 'POST' || metodo === 'DELETE')) {
        // Mesma permissão de publicar documento: uma única porta de saída
        // para o que chega ao cliente (§13).
        exigir(identidade.papeis, 'portal.publicar');
        if (metodo === 'DELETE') {
          return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
            processos.despublicarMovimentacao(db, mPublicarMov[1]!, identidade)));
        }
        const corpo = processos.EsquemaPublicacao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) {
          return erro('o resumo ao cliente é obrigatório e precisa ter ao menos 10 caracteres',
            400, corpo.error.issues);
        }
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.publicarMovimentacao(db, mPublicarMov[1]!, corpo.data, identidade)));
      }

      const mPrazos = /^\/api\/processos\/([0-9a-f-]{36})\/prazos$/.exec(rota);
      if (mPrazos && metodo === 'POST') {
        exigir(identidade.papeis, 'prazo.escrever');
        const corpo = processos.EsquemaPrazo.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.criarPrazo(db, mPrazos[1]!, corpo.data, identidade)), 201);
      }

      const mFecharPrazo = /^\/api\/prazos\/([0-9a-f-]{36})\/fechamento$/.exec(rota);
      if (mFecharPrazo && metodo === 'POST') {
        exigir(identidade.papeis, 'prazo.escrever');
        const corpo = processos.EsquemaFechamento.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          processos.fecharPrazo(db, mFecharPrazo[1]!, corpo.data, identidade)));
      }

      // ------------------------------------------------------ relatórios ---
      // O PDF gerado entra no ACERVO como qualquer outro documento: guardado
      // por conteúdo, baixado por URL assinada e publicado ao cliente pela
      // mesma porta (§13). Não há caminho especial para relatório.

      if (rota === '/api/relatorios/tipos' && metodo === 'GET') {
        exigir(identidade.papeis, 'relatorio.gerar');
        return json({
          tipos: relatorios.TIPOS_DE_RELATORIO,
          periodoPadrao: relatorios.periodoPadrao(),
        });
      }

      const mRelatorio = /^\/api\/projetos\/([0-9a-f-]{36})\/relatorios$/.exec(rota);
      if (mRelatorio && metodo === 'POST') {
        exigir(identidade.papeis, 'relatorio.gerar');
        const corpo = relatorios.EsquemaGeracao.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);

        return json(await banco.comoUsuario(identidade.usuarioId, async (db) => {
          const gerado = await relatorios.gerar(db, mRelatorio[1]!, corpo.data, identidade);
          const arquivo = new File([gerado.pdf as unknown as BlobPart], gerado.nome, {
            type: 'application/pdf',
          });
          const guardado = await arquivos.receber(
            db, mRelatorio[1]!, arquivo,
            { titulo: gerado.relatorio.titulo, categoria: 'Relatório' },
            identidade, deposito, 'interno');
          return {
            ...guardado,
            // A interface mostra as lacunas ANTES de alguém publicar: é a
            // última chance de ver o que o relatório não afirma.
            lacunas: gerado.relatorio.lacunas,
            fontes: gerado.relatorio.fontes,
            subtitulo: gerado.relatorio.subtitulo,
          };
        }), 201);
      }

      // --------------------------------------------------------- acervo ---

      if (rota === '/api/arquivos/estado' && metodo === 'GET') {
        exigir(identidade.papeis, 'documento.ler');
        return json(arquivos.estado(deposito));
      }

      const mLink = /^\/api\/documentos\/([0-9a-f-]{36})\/link$/.exec(rota);
      if (mLink && metodo === 'POST') {
        // POST, não GET: emitir link é ato que cria credencial e vai para a
        // auditoria do download. Também evita que um GET pré-carregado pelo
        // navegador emita links sozinho.
        exigir(identidade.papeis, 'documento.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          arquivos.emitirLink(db, mLink[1]!, identidade, deposito)));
      }

      // ----------------------------------------------- análise documental ---
      // Trabalho interno: não há política de portal nestas tabelas (migração
      // 011), então o cliente não alcança análise alguma, por rota nenhuma.

      if (rota === '/api/ia/estado' && metodo === 'GET') {
        // `analise.executar`, não `documento.ler`: a configuração de IA do
        // escritório é dado interno da NGA, e o cliente tem `documento.ler`.
        exigir(identidade.papeis, 'analise.executar');
        // A interface precisa saber o que NÃO vai rodar, para dizer ao usuário
        // em vez de deixá-lo supor (§18, §22).
        return json({...analise.estadoDaIa(provedor),...(ctx.analiseEmWorker?{trabalhadorExterno:true,impedimento:'Leitura automática pelo worker local do escritório. Depende de o Mac e o Ollama estarem ligados.'}:{})});
      }

      const mTexto = /^\/api\/documentos\/([0-9a-f-]{36})\/texto$/.exec(rota);
      if (mTexto && metodo === 'POST') {
        exigir(identidade.papeis, 'documento.escrever');
        const corpo = analise.EsquemaTexto.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.registrarTexto(db, mTexto[1]!, corpo.data, identidade)), 201);
      }

      const mExtrair = /^\/api\/documentos\/([0-9a-f-]{36})\/texto\/extrair$/.exec(rota);
      if (mExtrair && metodo === 'POST') {
        exigir(identidade.papeis, 'documento.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.extrairDoArquivo(db, mExtrair[1]!, identidade, deposito)), 201);
      }

      const mDiagnostico = /^\/api\/projetos\/([0-9a-f-]{36})\/diagnostico$/.exec(rota);
      if (mDiagnostico && metodo === 'GET') {
        // Diagnóstico é leitura interna da NGA sobre o cliente: o cliente não o alcança.
        exigir(identidade.papeis, 'analise.executar');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) => diagnostico(db, mDiagnostico[1]!)));
      }
      const mReprocessar = /^\/api\/documentos\/([0-9a-f-]{36})\/reprocessamento$/.exec(rota);
      if (mReprocessar && metodo === 'POST') {
        exigir(identidade.papeis, 'analise.executar');
        const estado = await analiseAuto.processar(banco, deposito, provedor, mReprocessar[1]!);
        return json({ estado });
      }

      const mAnalises = /^\/api\/documentos\/([0-9a-f-]{36})\/analises$/.exec(rota);
      if (mAnalises && metodo === 'GET') {
        exigir(identidade.papeis, 'documento.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.analises(db, mAnalises[1]!)));
      }
      if (mAnalises && metodo === 'POST') {
        exigir(identidade.papeis, 'analise.executar');
        const corpo = analise.EsquemaExecucao.safeParse(await req.json().catch(() => ({})));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);

        // TRÊS PASSOS, não um: a chamada ao modelo acontece FORA de transação.
        // Manter transação aberta durante um minuto de HTTP prende conexão do
        // pool e trava escrita alheia.
        const alvo = await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.carregar(db, mAnalises[1]!));
        const resultado = await analise.rodar(alvo, corpo.data, provedor);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.gravar(db, alvo, resultado, identidade)), 201);
      }

      const mAnaliseDetalhe = /^\/api\/analises\/([0-9a-f-]{36})$/.exec(rota);
      if (mAnaliseDetalhe && metodo === 'GET') {
        exigir(identidade.papeis, 'documento.ler');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.detalhe(db, mAnaliseDetalhe[1]!)));
      }

      const mValidarTipo = /^\/api\/analises\/([0-9a-f-]{36})\/validacao$/.exec(rota);
      if (mValidarTipo && metodo === 'POST') {
        // A classificação é da máquina; o tipo definitivo é de quem assina.
        exigir(identidade.papeis, 'analise.validar');
        const corpo = analise.EsquemaValidacaoDeTipo.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.validarTipo(db, mValidarTipo[1]!, corpo.data, identidade)));
      }

      const mTriagem = /^\/api\/achados\/([0-9a-f-]{36})\/triagem$/.exec(rota);
      if (mTriagem && metodo === 'POST') {
        exigir(identidade.papeis, 'documento.escrever');
        const corpo = analise.EsquemaTriagem.safeParse(await req.json().catch(() => null));
        if (!corpo.success) return erro('dados inválidos', 400, corpo.error.issues);
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          analise.triarAchado(db, mTriagem[1]!, corpo.data, identidade)));
      }

      // ------------------------------------------------------------ plano ---
      const mCronograma = /^\/api\/planos\/([0-9a-f-]{36})\/cronograma$/.exec(rota);
      if (mCronograma && metodo === 'POST') {
        exigir(identidade.papeis, 'plano.escrever');
        return json(await banco.comoUsuario(identidade.usuarioId, (db) =>
          gerarObrigacoes(db, mCronograma[1]!, identidade)), 201);
      }

      return erro('rota não encontrada', 404);
    } catch (e) {
      if (e instanceof SemPermissao) return erro(e.message, 403);
      // "Não encontrado" cobre também o que o RLS esconde: distinguir os dois
      // casos contaria ao cliente que o recurso existe (§13).
      if (e instanceof NaoEncontrado) return erro(e.message, 404);
      if (e instanceof PedidoInvalido) return erro(e.message, 400);
      if (e instanceof TransicaoInvalida) return erro(e.message, 409);
      if (e instanceof TransicaoDeFaseInvalida) return erro(e.message, 409);
      if (e instanceof ErroDeAutenticacao) return erro(e.message, 401);
      // Indisponibilidade de IA é impedimento de infraestrutura, com motivo
      // nomeado — não "erro interno" (§22).
      if (e instanceof ProvedorIndisponivel) return erro(e.impedimento, 503);
      if (e instanceof TipoRecusado) return erro(e.message, 415);
      if (e instanceof SemEscopo) return erro(e.message, 403);
      if (e instanceof ErroDePrazo) return erro(e.message, 400);
      // Link forjado e link vencido são respostas DIFERENTES: 410 diz ao
      // usuário legítimo que basta pedir outro, sem confirmar nada a quem
      // está tentando adivinhar assinatura.
      if (e instanceof AssinaturaExpirada) return erro(e.message, 410);
      if (e instanceof AssinaturaInvalida) return erro(e.message, 403);
      // Estes dois são falha do servidor de verdade, e têm de doer: o registro
      // diz que há arquivo e o acervo não entrega.
      if (e instanceof ArquivoAusente || e instanceof ArquivoCorrompido) {
        console.error('acervo inconsistente:', e);
        return erro(e.message, 500);
      }
      if (e instanceof z.ZodError) return erro('dados inválidos', 400, e.issues);
      const mensagem = (e as Error).message ?? 'erro interno';
      // 400 para violação de regra do banco (CHECK/constraint): é erro do
      // pedido, não do servidor.
      if (/violates (check|foreign key|unique)/i.test(mensagem)) return erro(mensagem, 400);
      if (/row-level security/i.test(mensagem)) return erro('acesso negado', 403);
      console.error('erro não tratado:', e);
      return erro('erro interno', 500);
    }
  };

  return Object.assign(tratar, { aguardarAnalises: () => Promise.allSettled([...pendentes]) });
}

// ------------------------------------------------------------- esquemas ---

const EsquemaLogin = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

const EsquemaCredor = z.object({
  nome: z.string().trim().min(1).max(300),
  documento: z.string().max(20).optional(),
  meEpp: z.boolean().default(false),
});

const NATUREZAS = [
  'trabalhista', 'acidente_trabalho', 'garantia_real', 'quirografario',
  'privilegio_especial', 'privilegio_geral', 'subordinado', 'me_epp',
  'tributario', 'proprietario_fiduciario', 'arrendamento_mercantil',
  'reserva_dominio', 'promitente_vendedor_irrevogavel',
  'adiantamento_contrato_cambio', 'posterior_ao_pedido',
] as const;

const EsquemaCredito = z.object({
  credorId: z.string().uuid(),
  // Centavos como string: um crédito bilionário não cabe com segurança em
  // Number, e JSON não tem BigInt.
  valor: z.string().regex(/^\d+$/, 'valor em centavos, só dígitos'),
  natureza: z.enum(NATUREZAS),
  valorBemGravado: z.string().regex(/^\d+$/).optional(),
});

const EsquemaValidacao = z.object({
  classe: z.enum(['I', 'II', 'III', 'IV']),
  sujeito: z.boolean(),
  observacao: z.string().max(2000).optional(),
});

// -------------------------------------------------------------- serviços ---

interface LinhaCredito {
  id: string; credor_id: string; credor: string; valor: string; natureza: string;
  valor_bem_gravado: string | null; me_epp: boolean;
  classe_sugerida: string | null; classe_validada: string | null;
  sujeito_validado: boolean | null; validado_em: Date | null; ressalvas: unknown;
}

function paraDominio(l: LinhaCredito): Credito {
  return {
    id: l.id, credor: l.credor, valor: BigInt(l.valor),
    natureza: l.natureza as Credito['natureza'],
    valorBemGravado: l.valor_bem_gravado === null ? undefined : BigInt(l.valor_bem_gravado),
    meEpp: l.me_epp,
  };
}

async function listarCreditos(db: PoolClient, projetoId: string) {
  const { rows } = await db.query<LinhaCredito>(
    `SELECT c.id, c.credor_id, cr.nome AS credor, c.valor, c.natureza, c.valor_bem_gravado,
            cr.me_epp, c.classe_sugerida, c.classe_validada, c.sujeito_validado,
            c.validado_em, c.ressalvas
       FROM creditos c JOIN credores cr ON cr.id = c.credor_id
      WHERE c.projeto_id = $1 ORDER BY c.valor DESC`, [projetoId]);

  const creditos = rows.map(paraDominio);
  return {
    creditos: rows.map((l, i) => ({
      ...l,
      valorFormatado: formatarReais(BigInt(l.valor)),
      enquadramentoSugerido: enquadrar(creditos[i]!),
      // Enquanto não houver validação humana, nada a jusante pode tratar a
      // classe como definitiva.
      definitivo: l.classe_validada !== null,
    })),
    consolidado: consolidarPorClasse(creditos).map((t) => ({
      ...t, valorFormatado: formatarReais(t.valor),
    })),
    pendentesDeValidacao: rows.filter((r) => r.classe_validada === null).length,
  };
}

async function criarCredito(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaCredito>, identidade: Identidade,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const organizacaoId = proj[0]?.organizacao_id;
  if (!organizacaoId) throw new NaoEncontrado('projeto não encontrado');

  const { rows: cred } = await db.query<{ nome: string; me_epp: boolean }>(
    'SELECT nome, me_epp FROM credores WHERE id = $1', [dados.credorId]);
  const credor = cred[0];
  if (!credor) throw new NaoEncontrado('credor não encontrado');

  // Enquadramento SUGERIDO, gravado junto com os fundamentos para auditoria.
  const sugestao = enquadrar({
    id: 'novo', credor: credor.nome, valor: BigInt(dados.valor),
    natureza: dados.natureza as Credito['natureza'],
    valorBemGravado: dados.valorBemGravado === undefined ? undefined : BigInt(dados.valorBemGravado),
    meEpp: credor.me_epp,
  });

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO creditos (organizacao_id, projeto_id, credor_id, valor, natureza,
       valor_bem_gravado, classe_sugerida, sujeito_sugerido, fundamentos, ressalvas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [organizacaoId, projetoId, dados.credorId, dados.valor, dados.natureza,
     dados.valorBemGravado ?? null, sugestao.classe, sugestao.sujeito,
     JSON.stringify(sugestao.fundamentos), JSON.stringify(sugestao.ressalvas)]);

  const id = rows[0]!.id;
  await auditar(db, {
    organizacaoId, usuarioId: identidade.usuarioId, acao: 'credito.criado',
    entidade: 'credito', entidadeId: id, depois: { ...dados, sugestao },
  });

  return { id, enquadramentoSugerido: sugestao, definitivo: false };
}

async function validarCredito(
  db: PoolClient, creditoId: string,
  dados: z.infer<typeof EsquemaValidacao>, identidade: Identidade,
) {
  const { rows: antes } = await db.query<LinhaCredito & { organizacao_id: string }>(
    `SELECT c.*, cr.nome AS credor FROM creditos c JOIN credores cr ON cr.id = c.credor_id
      WHERE c.id = $1`, [creditoId]);
  const atual = antes[0];
  if (!atual) throw new NaoEncontrado('crédito não encontrado');

  await db.query(
    `UPDATE creditos SET classe_validada=$2, sujeito_validado=$3, validado_por=$4,
            validado_em=now(), observacao_validacao=$5, atualizado_em=now()
      WHERE id=$1`,
    [creditoId, dados.classe, dados.sujeito, identidade.usuarioId, dados.observacao ?? null]);

  await auditar(db, {
    organizacaoId: atual.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'credito.validado', entidade: 'credito', entidadeId: creditoId,
    antes: { classeSugerida: atual.classe_sugerida, classeValidada: atual.classe_validada },
    depois: { classe: dados.classe, sujeito: dados.sujeito, observacao: dados.observacao },
  });

  return { id: creditoId, classe: dados.classe, sujeito: dados.sujeito, definitivo: true };
}

async function apurar(db: PoolClient, assembleiaId: string) {
  const { rows } = await db.query<{ credor: string; classe: string; valor: string; voto: string }>(
    `SELECT cr.nome AS credor, v.classe, v.valor, v.voto
       FROM votos v JOIN creditos c ON c.id = v.credito_id
       JOIN credores cr ON cr.id = c.credor_id
      WHERE v.assembleia_id = $1`, [assembleiaId]);

  const votos: VotoLancado[] = rows.map((r) => ({
    credor: r.credor, classe: r.classe as VotoLancado['classe'],
    valor: BigInt(r.valor), voto: r.voto as VotoLancado['voto'],
  }));

  const resultado = apurarAssembleia(votos);
  return {
    ...resultado,
    classes: resultado.classes.map((c) => ({
      ...c,
      presentes: { ...c.presentes, valorFormatado: formatarReais(c.presentes.valor) },
      sim: { ...c.sim, valorFormatado: formatarReais(c.sim.valor) },
      nao: { ...c.nao, valorFormatado: formatarReais(c.nao.valor) },
    })),
    totalDeVotos: votos.length,
  };
}

async function registrarApuracao(db: PoolClient, assembleiaId: string, identidade: Identidade) {
  const resultado = await apurar(db, assembleiaId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO apuracoes (assembleia_id, resultado, aprovado_art45, cram_down_cabivel, apurado_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [assembleiaId, JSON.stringify(resultado, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
     resultado.aprovadoPeloArt45, resultado.cramDown.cabivel, identidade.usuarioId]);

  const { rows: org } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM assembleias WHERE id = $1', [assembleiaId]);
  await auditar(db, {
    organizacaoId: org[0]?.organizacao_id ?? null, usuarioId: identidade.usuarioId,
    acao: 'agc.apurada', entidade: 'assembleia', entidadeId: assembleiaId,
    depois: { aprovadoArt45: resultado.aprovadoPeloArt45, cramDown: resultado.cramDown.cabivel },
  });

  return { id: rows[0]!.id, ...resultado };
}

/**
 * Materializa o cronograma do plano em obrigações.
 *
 * Usa SOMENTE créditos com classe VALIDADA: gerar calendário de pagamento a
 * partir de enquadramento sugerido por máquina seria exatamente o que o §7.7
 * proíbe. Os pendentes voltam na resposta para serem validados antes.
 */
async function gerarObrigacoes(db: PoolClient, planoId: string, identidade: Identidade) {
  const { rows: planos } = await db.query<{
    organizacao_id: string; projeto_id: string; data_base: Date;
  }>('SELECT organizacao_id, projeto_id, data_base FROM planos WHERE id = $1', [planoId]);
  const plano = planos[0];
  if (!plano) throw new NaoEncontrado('plano não encontrado');

  const { rows: condicoes } = await db.query<{
    classe: string; desagio: string; carencia_meses: number; parcelas: number;
    periodicidade: string; juros_ao_ano: string; regime_juros: string;
    sistema: string; capitaliza_carencia: boolean;
  }>('SELECT * FROM condicoes_pagamento WHERE plano_id = $1', [planoId]);
  if (condicoes.length === 0) throw new PedidoInvalido('plano sem condições de pagamento cadastradas');

  const porClasse = new Map<string, CondicaoDePagamento>(condicoes.map((c) => [c.classe, {
    desagio: Number(c.desagio), carenciaMeses: c.carencia_meses, parcelas: c.parcelas,
    periodicidade: c.periodicidade as CondicaoDePagamento['periodicidade'],
    jurosAoAno: Number(c.juros_ao_ano),
    regimeDeJuros: c.regime_juros as CondicaoDePagamento['regimeDeJuros'],
    sistema: c.sistema as CondicaoDePagamento['sistema'],
    capitalizarNaCarencia: c.capitaliza_carencia,
  }]));

  const { rows: creditos } = await db.query<{
    id: string; valor: string; classe_validada: string | null; sujeito_validado: boolean | null;
  }>(`SELECT id, valor, classe_validada, sujeito_validado FROM creditos WHERE projeto_id = $1`,
    [plano.projeto_id]);

  const pendentes = creditos.filter((c) => c.classe_validada === null).map((c) => c.id);
  const elegiveis = creditos.filter((c) => c.classe_validada !== null && c.sujeito_validado === true);

  const dataBase = plano.data_base.toISOString().slice(0, 10);
  await db.query('DELETE FROM obrigacoes WHERE plano_id = $1', [planoId]);

  let geradas = 0;
  const semCondicao = new Set<string>();
  for (const credito of elegiveis) {
    const condicao = porClasse.get(credito.classe_validada!);
    if (!condicao) { semCondicao.add(credito.classe_validada!); continue; }

    const cronograma = gerarCronograma(BigInt(credito.valor), condicao, dataBase);
    for (const p of cronograma.parcelas) {
      await db.query(
        `INSERT INTO obrigacoes (organizacao_id, plano_id, credito_id, numero, vencimento,
           saldo_inicial, juros, amortizacao, valor, saldo_final)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [plano.organizacao_id, planoId, credito.id, p.numero, p.vencimento,
         p.saldoInicial.toString(), p.juros.toString(), p.amortizacao.toString(),
         p.valor.toString(), p.saldoFinal.toString()]);
      geradas++;
    }
  }

  await auditar(db, {
    organizacaoId: plano.organizacao_id, usuarioId: identidade.usuarioId,
    acao: 'plano.cronograma_gerado', entidade: 'plano', entidadeId: planoId,
    depois: { obrigacoes: geradas, creditos: elegiveis.length, pendentes: pendentes.length },
  });

  return {
    obrigacoesGeradas: geradas,
    creditosProcessados: elegiveis.length,
    // O chamador precisa saber o que FICOU DE FORA, não só o que entrou.
    creditosPendentesDeValidacao: pendentes.length,
    classesSemCondicaoCadastrada: [...semCondicao],
  };
}


async function criarCredor(
  db: PoolClient, projetoId: string,
  dados: z.infer<typeof EsquemaCredor>, identidade: Identidade,
) {
  const { rows: proj } = await db.query<{ organizacao_id: string }>(
    'SELECT organizacao_id FROM projetos WHERE id = $1', [projetoId]);
  const organizacaoId = proj[0]?.organizacao_id;
  if (!organizacaoId) throw new NaoEncontrado('projeto não encontrado');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO credores (organizacao_id, projeto_id, nome, documento, me_epp)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [organizacaoId, projetoId, dados.nome, dados.documento ?? null, dados.meEpp]);

  await auditar(db, {
    organizacaoId, usuarioId: identidade.usuarioId, acao: 'credor.criado',
    entidade: 'credor', entidadeId: rows[0]!.id, depois: dados,
  });
  return { id: rows[0]!.id };
}
