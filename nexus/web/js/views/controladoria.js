/**
 * Controladoria: as publicações do DJEN para as OABs dos sócios.
 *
 * Restrita a sócio administrador e controladoria (o servidor recusa os demais; a navegação só não oferece).
 * O texto da publicação é DADO de terceiros: aparece como texto, nunca como instrução. O prazo não nasce
 * sozinho: "Calcular prazo" abre o cálculo com a data da publicação já preenchida, para a pessoa conferir.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';
import { novoPrazo } from './projeto_extra.js';

const FILTROS = [['nova', 'Novas'], ['lida', 'Lidas'], ['tratada', 'Tratadas'], ['descartada', 'Descartadas'], ['todas', 'Todas']];
const mascara = (d) => (/^\d{20}$/.test(d) ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : d);
const TOM = { nova: 'aviso', lida: 'info', tratada: 'ok', descartada: '' };
let filtro = 'nova';

export default async function controladoria() {
  const [oabs, lista] = await Promise.all([api.get('/api/controladoria/oabs'), api.get(`/api/controladoria/publicacoes?situacao=${filtro}`)]);
  const gere = pode('controladoria.gerir');
  const r = lista.resumo;
  const ultima = oabs.map((o) => o.ultima_sincronizacao).filter(Boolean).sort().pop();
  return {
    titulo: 'Controladoria',
    html: html`${cabecalho({
      titulo: 'Controladoria', sub: oabs.length ? `Diário de Justiça Eletrônico Nacional · ${oabs.filter((o) => o.ativo).length} OAB(s) monitorada(s) · ${ultima ? `última busca ${relativo(ultima)}` : 'ainda não buscou'}` : 'Cadastre as OABs dos sócios para começar a receber as publicações.',
      acoes: gere ? html`<button type="button" class="btn btn--ghost" data-oabs>${icone('user')}OABs</button><button type="button" class="btn btn--accent" data-sync>${icone('refresh')}Buscar agora</button>` : '',
      resumo: [{ rotulo: 'Novas', valor: r.novas, tom: r.novas ? 'warn' : '' }, { rotulo: 'Lidas', valor: r.lidas }, { rotulo: 'Tratadas', valor: r.tratadas }],
    })}
    <div class="tabs glass glass--chrome mt up" role="tablist" id="filtros"><span class="tabs__pill" aria-hidden="true"></span>
      ${FILTROS.map(([v, t]) => html`<button type="button" role="tab" data-filtro="${v}" aria-selected="${v === filtro}">${t}</button>`)}</div>
    ${oabs.some((o) => o.ultimo_erro) ? html`<p class="selo erro mt" style="display:flex">${icone('alert')}Alguma OAB falhou na última busca: ${oabs.find((o) => o.ultimo_erro).ultimo_erro}</p>` : ''}
    <div class="mt" style="display:grid;gap:12px">${lista.publicacoes.length ? lista.publicacoes.map((p) => html`<article class="card glass up" data-pub="${p.id}">
        <header class="card__head"><div><h3 class="card__title" style="font-size:18px">${p.tipo ?? 'Publicação'} · ${p.tribunal ?? ''}</h3>
          <p class="card__sub">${p.orgao ?? ''} · disponibilizada em ${dataBR(p.data_disponibilizacao)}${p.classe ? ` · ${p.classe}` : ''}</p></div>
          <span class="selo ${TOM[p.situacao]}"><i></i>${p.situacao}</span></header>
        <div class="flex" style="margin-bottom:10px"><span class="mono-sm">${mascara(p.numero_processo ?? '')}</span>
          ${p.processo_id ? html`<a class="pchip" href="#/projetos/${p.projeto_id}/processos"><i></i><span class="tk-ellip">${p.projeto}</span></a>` : html`<span class="selo aviso">processo não cadastrado</span>`}
          ${p.oabs.map((o) => html`<span class="selo info">${o}</span>`)}</div>
        <p class="pub-texto" data-texto>${p.texto.length > 420 ? `${p.texto.slice(0, 420)}…` : p.texto}</p>
        ${p.texto.length > 420 ? html`<button type="button" class="link" data-mais="${p.id}">ver o texto inteiro</button>` : ''}
        ${p.observacao ? html`<p class="dica">Observação: ${p.observacao}${p.tratada_por_nome ? ` — ${p.tratada_por_nome}` : ''}</p>` : ''}
        ${gere ? html`<div class="flex mt">
          ${p.processo_id ? html`<button type="button" class="btn btn--accent" data-prazo="${p.id}">${icone('calendar')}Calcular prazo</button>` : html`<button type="button" class="btn btn--accent" data-cadastrar="${p.id}">${icone('plus')}Cadastrar processo</button>`}
          ${p.situacao !== 'lida' && p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="lida">Marcar como lida</button>` : ''}
          ${p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="tratada">Tratada</button>` : html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="nova">Reabrir</button>`}
          ${p.situacao !== 'descartada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="descartada">Descartar</button>` : ''}
          ${p.link ? html`<a class="btn btn--ghost" href="${p.link}" target="_blank" rel="noopener noreferrer">${icone('arrowUpRight')}Diário</a>` : ''}</div>` : ''}</article>`)
      : html`<section class="card glass up">${vazio('inbox', oabs.length ? 'Nenhuma publicação neste filtro' : 'Nenhuma OAB cadastrada', oabs.length ? 'Use "Buscar agora" ou troque o filtro. A busca automática roda a cada hora.' : 'Cadastre as OABs dos sócios; o sistema busca no DJEN e traz as publicações para cá.', gere && !oabs.length ? '<button class="btn btn--accent" data-oabs>Cadastrar OABs</button>' : '')}</section>`}</div>`,
    depois(el) {
      ouvir(el, 'click', '[data-filtro]', (b) => { filtro = b.dataset.filtro; navegar(); });
      ouvir(el, 'click', '[data-sync]', async (b) => {
        b.disabled = true; b.textContent = 'Buscando no DJEN…';
        try { const r2 = await api.post('/api/controladoria/sincronizacao', {}); const falhas = r2.resultados.filter((x) => x.erro); toast(falhas.length ? `Busca com falhas: ${falhas[0].erro}` : `${r2.novas} publicação(ões) nova(s)`, falhas.length ? 'aviso' : 'ok'); navegar(); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      ouvir(el, 'click', '[data-oabs]', () => gerirOabs(oabs));
      ouvir(el, 'click', '[data-mais]', (b) => { const p = lista.publicacoes.find((x) => x.id === b.dataset.mais); const t = b.closest('article').querySelector('[data-texto]'); t.textContent = p.texto; b.remove(); });
      ouvir(el, 'click', '[data-sit]', async (b) => { try { await api.patch(`/api/controladoria/publicacoes/${b.dataset.sit}`, { situacao: b.dataset.v }); navegar(); } catch (e) { erroDe(e); } });
      ouvir(el, 'click', '[data-prazo]', async (b) => {
        const p = lista.publicacoes.find((x) => x.id === b.dataset.prazo);
        if (await novoPrazo(p.processo_id, { evento: String(p.data_disponibilizacao).slice(0, 10), origem: 'disponibilizacao_dje' })) {
          await api.patch(`/api/controladoria/publicacoes/${p.id}`, { situacao: 'tratada', observacao: 'Prazo calculado a partir desta publicação.' }).catch(() => {}); navegar();
        }
      });
      ouvir(el, 'click', '[data-cadastrar]', async (b) => {
        const p = lista.publicacoes.find((x) => x.id === b.dataset.cadastrar);
        const projetos = (await api.get('/api/projetos')).filter((x) => x.situacao !== 'encerrado');
        if (!projetos.length) return toast('Crie um projeto antes de cadastrar o processo.', 'aviso');
        const ok = await formulario({
          titulo: 'Cadastrar processo', subtitulo: 'A publicação fica vinculada a ele.', rotulo: 'Cadastrar',
          campos: [{ nome: 'projetoId', rotulo: 'Projeto', tipo: 'select', obrigatorio: true, opcoes: projetos.map((x) => ({ v: x.id, t: x.nome })) },
            { nome: 'numero', rotulo: 'Número (CNJ)', obrigatorio: true, valor: mascara(p.numero_processo ?? '') },
            { nome: 'tribunal', rotulo: 'Tribunal', metade: true, valor: p.tribunal ?? '' }, { nome: 'classe', rotulo: 'Classe', metade: true, valor: p.classe ?? '' }],
          async enviar(v) { const r2 = await api.post('/api/processos', { numero: v.numero, projetoId: v.projetoId, tribunal: v.tribunal, classe: v.classe }); await api.patch(`/api/controladoria/publicacoes/${p.id}`, { processoId: r2.id }); toast('Processo cadastrado e vinculado'); },
        });
        if (ok) navegar();
      });
    },
  };
}

async function gerirOabs(oabs) {
  await formulario({
    titulo: 'OABs monitoradas', subtitulo: `${oabs.length ? oabs.map((o) => `${o.nome} (${o.numero_oab}/${o.uf_oab}${o.ativo ? '' : ', pausada'})`).join(' · ') : 'Nenhuma ainda.'} Para pausar uma OAB, use o botão abaixo.`, rotulo: 'Cadastrar OAB',
    campos: [{ nome: 'nome', rotulo: 'Nome do advogado(a)', obrigatorio: true }, { nome: 'numeroOab', rotulo: 'Número da OAB', obrigatorio: true, metade: true, placeholder: 'Só dígitos' }, { nome: 'ufOab', rotulo: 'UF', obrigatorio: true, metade: true, placeholder: 'PR', valor: 'PR' }],
    async enviar(v) { await api.post('/api/controladoria/oabs', v); toast('OAB cadastrada — use "Buscar agora"'); },
  });
  navegar();
}
