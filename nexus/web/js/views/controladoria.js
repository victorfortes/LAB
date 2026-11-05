/**
 * Controladoria: as publicações do DJEN para as OABs dos sócios.
 *
 * Restrita a sócio administrador e controladoria (o servidor recusa os demais; a navegação só não oferece).
 * O texto da publicação é DADO de terceiros: aparece como texto, nunca como instrução. O prazo não nasce
 * sozinho: "Calcular prazo" abre o cálculo com a data da publicação já preenchida, para a pessoa conferir.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, hojeISO, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';
import { novoPrazo } from './projeto_extra.js';

const FILTROS = [['nova', 'Novas'], ['lida', 'Lidas'], ['tratada', 'Tratadas'], ['descartada', 'Descartadas'], ['todas', 'Todas']];
const mascara = (d) => (/^\d{20}$/.test(d) ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : d);
const TOM = { nova: 'aviso', lida: 'info', tratada: 'ok', descartada: '' };
let filtro = 'nova';
let periodoInicio = hojeISO(), periodoFim = hojeISO(), historico = false;

export default async function controladoria() {
  const [oabs, lista] = await Promise.all([api.get('/api/controladoria/oabs'), api.get(`/api/controladoria/publicacoes?situacao=${filtro}${historico ? '&periodo=todas' : `&inicio=${periodoInicio}&fim=${periodoFim}`}`)]);
  for(const p of lista.publicacoes)p.texto=p.texto_legivel??p.texto;
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
    <form class="tk-bar glass mt" data-periodo><label class="field"><span>Disponibilização de</span><input class="input" type="date" name="inicio" value="${periodoInicio}" required></label><label class="field"><span>Até</span><input class="input" type="date" name="fim" value="${periodoFim}" required></label><button class="btn btn--ghost" type="submit">Aplicar período</button><button class="btn btn--ghost" type="button" data-hoje>Hoje (${lista.totais?.hoje ?? 0})</button><button class="btn btn--ghost" type="button" data-historico>Histórico (${lista.totais?.historico ?? 0})</button></form>
    <p class="dica mt">${historico ? 'Exibindo todo o histórico' : `Disponibilizações de ${dataBR(periodoInicio)} a ${dataBR(periodoFim)}`} · ${lista.publicacoes.length} publicação(ões) neste filtro.</p>
    <div class="tabs glass glass--chrome mt up" role="tablist" id="filtros"><span class="tabs__pill" aria-hidden="true"></span>
      ${FILTROS.map(([v, t]) => html`<button type="button" role="tab" data-filtro="${v}" aria-selected="${v === filtro}">${t}</button>`)}</div>
    ${oabs.some((o) => o.ultimo_erro) ? html`<p class="selo erro mt" style="display:flex">${icone('alert')}Alguma OAB falhou na última busca: ${oabs.find((o) => o.ultimo_erro).ultimo_erro}</p>` : ''}
    <div class="mt" style="display:grid;gap:12px">${lista.publicacoes.length ? lista.publicacoes.map((p) => html`<article class="card glass up" data-pub="${p.id}">
        <header class="card__head"><div><h3 class="card__title" style="font-size:18px"><button type="button" class="link" data-detalhar="${p.id}">${p.tipo ?? 'Publicação'} · ${p.tribunal ?? ''}</button></h3>
          <p class="card__sub">${p.orgao ?? ''} · disponibilizada em ${dataBR(p.data_disponibilizacao)}${p.classe ? ` · ${p.classe}` : ''}</p></div>
          <span class="selo ${TOM[p.situacao]}"><i></i>${p.situacao}</span></header>
        <div class="flex" style="margin-bottom:10px"><span class="mono-sm">${mascara(p.numero_processo ?? '')}</span>
          ${p.processo_id ? html`<a class="pchip" href="#/projetos/${p.projeto_id}/processos"><i></i><span class="tk-ellip">${p.projeto}</span></a>` : html`<span class="selo aviso">processo não cadastrado</span>`}
          ${p.oabs.map((o) => html`<span class="selo info">${o}</span>`)}</div>
        <p class="pub-texto" data-texto>${p.texto.length > 420 ? `${p.texto.slice(0, 420)}…` : p.texto}</p>
        ${p.texto.length > 420 ? html`<button type="button" class="link" data-mais="${p.id}">Abrir intimação completa e analisar</button>` : ''}
        ${p.observacao ? html`<p class="dica">Observação: ${p.observacao}${p.tratada_por_nome ? ` — ${p.tratada_por_nome}` : ''}</p>` : ''}
        ${gere ? html`<div class="flex mt">
          ${p.processo_id ? html`<button type="button" class="btn btn--accent" data-prazo="${p.id}">${icone('calendar')}Calcular prazo</button><button type="button" class="btn btn--ghost" data-agendar="${p.id}">Agendar prazo e tarefa</button>` : html`<button type="button" class="btn btn--accent" data-cadastrar="${p.id}">${icone('plus')}Cadastrar processo</button>`}
          ${p.situacao !== 'lida' && p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="lida">Marcar como lida</button>` : ''}
          ${p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="tratada">Tratada</button>` : html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="nova">Reabrir</button>`}
          ${p.situacao !== 'descartada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="descartada">Descartar</button>` : ''}
          ${p.link ? html`<a class="btn btn--ghost" href="${p.link}" target="_blank" rel="noopener noreferrer">${icone('arrowUpRight')}Diário</a>` : ''}</div>` : ''}</article>`)
      : html`<section class="card glass up">${vazio('inbox', oabs.length ? 'Nenhuma publicação neste filtro' : 'Nenhuma OAB cadastrada', oabs.length ? 'Use "Buscar agora" ou troque o filtro. A busca automática roda a cada hora.' : 'Cadastre as OABs dos sócios; o sistema busca no DJEN e traz as publicações para cá.', gere && !oabs.length ? '<button class="btn btn--accent" data-oabs>Cadastrar OABs</button>' : '')}</section>`}</div>`,
    depois(el) {
      el.querySelector('[data-periodo]').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; if (f.elements.fim.value < f.elements.inicio.value) return toast('O fim do período deve ser após o início.', 'erro'); periodoInicio = f.elements.inicio.value; periodoFim = f.elements.fim.value; historico = false; navegar(); });
      ouvir(el, 'click', '[data-hoje]', () => { periodoInicio = periodoFim = hojeISO(); historico = false; navegar(); });
      ouvir(el, 'click', '[data-historico]', () => { historico = true; navegar(); });
      ouvir(el, 'click', '[data-agendar]', async (b) => {
        const p = lista.publicacoes.find((x) => x.id === b.dataset.agendar);
        const ok = await formulario({ titulo:'Agendar prazo e tarefa',subtitulo:`${p.projeto} · disponibilização ${dataBR(p.data_disponibilizacao)}`,rotulo:'Calcular e agendar',campos:[{nome:'titulo',rotulo:'Providência',obrigatorio:true},{nome:'dias',rotulo:'Prazo em dias',tipo:'number',min:1,obrigatorio:true},{nome:'regime',rotulo:'Contagem',tipo:'select',valor:'uteis',opcoes:[{v:'uteis',t:'Dias úteis'},{v:'corridos',t:'Dias corridos'}]},{nome:'feriados',rotulo:'Feriados locais (AAAA-MM-DD separados por vírgula)',dica:'Confira as suspensões e os feriados da comarca antes de agendar.'}],enviar:async (v) => { const feriadosLocais = (v.feriados ?? '').split(',').map((d) => d.trim()).filter(Boolean); if (feriadosLocais.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('Use datas no formato AAAA-MM-DD.'); const r = await api.post(`/api/controladoria/publicacoes/${p.id}/agendamento`,{titulo:v.titulo,dias:v.dias,regime:v.regime,feriadosLocais}); toast(r.repetido ? 'O agendamento já existe' : 'Prazo e tarefa agendados'); }}); if (ok) navegar();
      });
      ouvir(el, 'click', '[data-filtro]', (b) => { filtro = b.dataset.filtro; navegar(); });
      ouvir(el, 'click', '[data-sync]', async (b) => {
        b.disabled = true; b.textContent = 'Buscando no DJEN…';
        try { const r2 = await api.post('/api/controladoria/sincronizacao', {}); const falhas = r2.resultados.filter((x) => x.erro); toast(falhas.length ? `Busca com falhas: ${falhas[0].erro}` : `${r2.novas} publicação(ões) nova(s)`, falhas.length ? 'aviso' : 'ok'); navegar(); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      ouvir(el, 'click', '[data-oabs]', () => gerirOabs(oabs));
      ouvir(el, 'click', '[data-mais]', (b) => abrirPublicacao(b.dataset.mais).catch(erroDe));
      ouvir(el, 'click', '[data-detalhar]', (b) => abrirPublicacao(b.dataset.detalhar).catch(erroDe));
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


/** Safe full-text reader; every interpolation is escaped, including model output. */
export async function abrirPublicacao(id) {
  const p=await api.get(`/api/controladoria/publicacoes/${id}/detalhe`);
  const gere=pode('controladoria.gerir');
  await modal({titulo:`${p.tipo??'Intimação'} · ${p.tribunal??''}`,subtitulo:`${mascara(p.numero_processo??'')} · disponibilização ${dataBR(p.data_disponibilizacao)}`,largo:true,
    corpo:html`<div class="pub-reader"><section><div class="flex"><span class="selo info">${p.projeto??'Processo ainda sem projeto vinculado'}</span>${p.prazo_id?html`<span class="selo ok">Prazo já agendado</span>`:''}</div><h3>Inteiro teor</h3><div class="pub-reader__text">${p.texto_legivel??p.texto}</div><p class="dica">Texto exibido sem marcação HTML. O conteúdo original permanece preservado na base.</p>${p.link?html`<a class="btn btn--ghost" href="${p.link}" target="_blank" rel="noopener noreferrer">Conferir no Diário</a>`:''}</section><aside class="pub-reader__analysis"><h3>Análise da intimação</h3><p class="dica">A tarefa de analisar a intimação e o prazo processual são registros separados. O agendamento depende da sua confirmação.</p><button class="btn btn--accent" type="button" data-analisar>${icone('search')}Analisar e sugerir prazo</button><div data-resultado aria-live="polite"></div></aside></div>`,
    acoes:[{id:'fechar',rotulo:'Fechar'}],aoAbrir(el){
      el.addEventListener('acao',()=>el.fechar(true));
      const analisar=async()=>{
        const button=el.querySelector('[data-analisar]');const slot=el.querySelector('[data-resultado]');button.disabled=true;button.textContent='Lendo a publicação…';
        try{
          const result=await api.post(`/api/controladoria/publicacoes/${id}/analise`,{});if(!el.isConnected)return;
          const sug=result.sugestao;
          slot.innerHTML=String(html`<p class="selo ${result.fonte==='ia_local'?'info':'aviso'}">${result.fonte==='ia_local'?`IA local · ${result.modelo}`:'Extração literal, sem leitura de IA'}</p>${result.resumo?html`<h4>Resumo sugerido pela IA</h4><p>${result.resumo}</p>`:''}${result.avisoIA?html`<p class="dica">${result.avisoIA}</p>`:''}${sug?html`<h4>Prazo expresso identificado</h4><p><b>${sug.dias} dias ${sug.regime==='uteis'?'úteis':'corridos'}</b> · vencimento preliminar <b>${dataBR(sug.calculo.vencimento)}</b></p><blockquote>${sug.trecho}</blockquote><p class="dica">Publicação considerada: ${dataBR(sug.calculo.publicacao)} · primeiro dia contado: ${dataBR(sug.calculo.primeiroDiaContado)}.</p>`:html`<p class="selo aviso">Sem prazo único seguro para agendamento rápido.</p>`}<ul class="dica">${result.ressalvas.map(r=>html`<li>${r}</li>`)}</ul>${gere&&sug&&!p.prazo_id?html`<p class="dica">Ao confirmar, você declara que conferiu o termo inicial e o calendário aplicável. Será criado o prazo processual com uma tarefa de cumprimento; a análise da intimação será concluída.</p><button class="btn btn--accent" type="button" data-confirmar-prazo ${!p.projeto_id?'disabled':''}>Confirmar ${sug.dias} dias ${sug.regime==='uteis'?'úteis':'corridos'} e agendar</button>`:''}${gere&&!p.prazo_id?html`<button class="btn btn--ghost mt" type="button" data-ajustar-prazo ${!p.projeto_id?'disabled':''}>Revisar dias e feriados locais</button>`:''}${!p.projeto_id?html`<p class="dica">Cadastre e vincule este processo a um projeto para agendar.</p>`:''}`);
          slot.querySelector('[data-confirmar-prazo]')?.addEventListener('click',async(e)=>{
            const b=e.currentTarget;b.disabled=true;
            try{const r=await api.post(`/api/controladoria/publicacoes/${id}/agendamento`,{titulo:`Providência processual · ${mascara(p.numero_processo??'')}`,dias:sug.dias,regime:sug.regime,feriadosLocais:[]});toast(r.repetido?'Este prazo já estava agendado':'Prazo processual e tarefa agendados');el.fechar(true);navegar();}catch(error){b.disabled=false;el.erro(error.message);}
          });
          slot.querySelector('[data-ajustar-prazo]')?.addEventListener('click',async()=>{
            const saved=await formulario({titulo:'Conferir prazo processual',subtitulo:'A contagem é recalculada com os feriados que você informar.',rotulo:'Confirmar e agendar',campos:[{nome:'titulo',rotulo:'Providência',obrigatorio:true,valor:`Providência processual · ${mascara(p.numero_processo??'')}`},{nome:'dias',rotulo:'Dias',tipo:'number',min:1,obrigatorio:true,valor:sug?.dias},{nome:'regime',rotulo:'Regime',tipo:'select',valor:sug?.regime??'uteis',opcoes:[{v:'uteis',t:'Dias úteis'},{v:'corridos',t:'Dias corridos'}]},{nome:'feriados',rotulo:'Feriados locais',dica:'AAAA-MM-DD, separados por vírgula'}],enviar:async(v)=>{const dates=(v.feriados??'').split(',').map(d=>d.trim()).filter(Boolean);await api.post(`/api/controladoria/publicacoes/${id}/agendamento`,{titulo:v.titulo,dias:v.dias,regime:v.regime,feriadosLocais:dates});toast('Prazo e tarefa agendados');}});
            if(saved){el.fechar(true);navegar();}
          });
        }catch(error){if(el.isConnected)el.erro(error.message);}finally{if(el.isConnected){button.disabled=false;button.textContent='Analisar novamente';}}
      };
      el.querySelector('[data-analisar]').addEventListener('click',analisar);
    }});
}
