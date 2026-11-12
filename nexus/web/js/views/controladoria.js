/**
 * Controladoria: as publicações do DJEN para as OABs dos sócios.
 *
 * Restrita a sócio administrador e controladoria (o servidor recusa os demais; a navegação só não oferece).
 * O texto da publicação é DADO de terceiros: aparece como texto, nunca como instrução. O prazo não nasce
 * sozinho: "Calcular prazo" abre o cálculo com a data da publicação já preenchida, para a pessoa conferir.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, esc, hojeISO, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';
import { novoPrazo } from './projeto_extra.js';

const FILTROS = [['nova', 'Novas'], ['lida', 'Lidas'], ['tratada', 'Tratadas'], ['descartada', 'Descartadas'], ['todas', 'Todas']];
const mascara = (d) => (/^\d{20}$/.test(d) ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}` : d);
const TOM = { nova: 'aviso', lida: 'info', tratada: 'ok', descartada: '' };
let filtro = 'nova';
let periodoInicio = hojeISO(), periodoFim = hojeISO(), historico = false;
let consulta='',oabFiltro='',pagina=1;

export default async function controladoria() {
  const [pendentes, oabs, lista] = await Promise.all([api.get('/api/controladoria/prazos-astrea'), api.get('/api/controladoria/oabs'), api.get(`/api/controladoria/publicacoes?situacao=${filtro}${historico ? '&periodo=todas' : `&inicio=${periodoInicio}&fim=${periodoFim}`}&q=${encodeURIComponent(consulta)}&oab=${encodeURIComponent(oabFiltro)}&pagina=${pagina}`)]);
  for(const p of lista.publicacoes)p.texto=p.texto_legivel??p.texto;
  const gere = pode('controladoria.gerir');
  const r = lista.resumo;
  const ultima = oabs.map((o) => o.ultima_sincronizacao).filter(Boolean).sort().pop();
  return {
    titulo: 'Controladoria',
    html: html`${cabecalho({
      titulo: 'Controladoria', sub: oabs.length ? `Diário de Justiça Eletrônico Nacional · ${oabs.filter((o) => o.ativo).length} OAB(s) monitorada(s) · ${ultima ? `última busca ${relativo(ultima)}` : 'ainda não buscou'}` : 'Cadastre as OABs dos sócios para começar a receber as publicações.',
      acoes: gere ? html`<button type="button" class="btn btn--ghost" data-confronto>${icone('link')}Confrontar com o Astrea</button><button type="button" class="btn btn--ghost" data-oabs>${icone('user')}OABs</button><button type="button" class="btn btn--accent" data-sync>${icone('refresh')}Buscar agora</button>` : '',
      resumo: [{ rotulo: 'Novas', valor: r.novas, tom: r.novas ? 'warn' : '' }, { rotulo: 'Lidas', valor: r.lidas }, { rotulo: 'Tratadas', valor: r.tratadas }],
    })}
    ${pendentes.length ? html`<section class="card glass mt" aria-labelledby="astrea-titulo">
      <header class="card__head"><div><h2 class="card__title" id="astrea-titulo">Prazos do Astrea a vincular</h2>
      <p class="card__sub">Confira o cliente e vincule o processo ao projeto. O Nexus importa os vencimentos confirmados no Astrea e as tarefas correspondentes.</p></div></header>
      ${pendentes.map((item) => html`<details class="mt">
        <summary><span class="mono-sm">${item.numero_processo}</span> · ${item.prazos.length} prazo(s) · primeiro vencimento em ${dataBR(item.prazos[0].vencimento)}</summary>
        <ul>${item.prazos.map((p) => html`<li>${dataBR(p.vencimento)} · ${p.titulo}</li>`)}</ul>
        ${gere ? html`<button type="button" class="btn btn--ghost" data-astrea-vincular="${item.id}">Vincular ao projeto</button>` : ''}
      </details>`)}
    </section>` : ''}
    <form class="tk-bar glass mt" data-periodo><label class="field"><span>Disponibilização de</span><input class="input" type="date" name="inicio" value="${periodoInicio}" required></label><label class="field"><span>Até</span><input class="input" type="date" name="fim" value="${periodoFim}" required></label><button class="btn btn--ghost" type="submit">Aplicar período</button><button class="btn btn--ghost" type="button" data-hoje>Hoje (${lista.totais?.hoje ?? 0})</button><button class="btn btn--ghost" type="button" data-historico>Histórico (${lista.totais?.historico ?? 0})</button></form>
    <form class="tk-bar glass mt" data-busca-pub><label class="field"><span>Buscar publicação ou processo</span><input class="input" name="q" type="search" value="${consulta}" placeholder="Número CNJ, órgão ou trecho da intimação"></label><label class="field"><span>Advogado / OAB</span><select class="select" name="oab"><option value="">Todas as OABs</option>${oabs.map(o=>html`<option value="${o.nome}" ${o.nome===oabFiltro?html`selected`:''}>${o.nome} · ${o.numero_oab}/${o.uf_oab}</option>`)}</select></label><button class="btn btn--ghost">Pesquisar</button></form>
    <p class="dica mt">${historico ? 'Exibindo todo o histórico' : `Disponibilizações de ${dataBR(periodoInicio)} a ${dataBR(periodoFim)}`} · ${lista.publicacoes.length} publicação(ões) neste filtro.</p>
    <div class="tabs glass glass--chrome mt up" role="tablist" id="filtros"><span class="tabs__pill" aria-hidden="true"></span>
      ${FILTROS.map(([v, t]) => html`<button type="button" role="tab" data-filtro="${v}" aria-selected="${v === filtro}">${t}</button>`)}</div>
    ${oabs.some((o) => o.ultimo_erro) ? html`<p class="selo erro mt" style="display:flex">${icone('alert')}Alguma OAB falhou na última busca: ${oabs.find((o) => o.ultimo_erro).ultimo_erro}</p>` : ''}
    ${gere&&lista.publicacoes.length?html`<div class="flex mt" data-lote-pub><label class="dica"><input type="checkbox" data-todas-pub> Selecionar página</label><span class="dica" data-nsel>0 selecionadas</span><button class="btn btn--ghost" type="button" data-lote-ler>Marcar como lidas</button><button class="btn btn--ghost" type="button" data-lote-abrir>Abrir selecionadas</button></div>`:''}
    <div class="mt" style="display:grid;gap:12px">${lista.publicacoes.length ? lista.publicacoes.map((p) => html`<article class="card glass up" data-pub="${p.id}">
        <header class="card__head"><div>${gere?html`<label class="dica"><input type="checkbox" data-pubsel="${p.id}" aria-label="Selecionar publicação ${p.comunicacao_id}"> Selecionar</label>`:''}<h3 class="card__title" style="font-size:18px"><button type="button" class="link" data-detalhar="${p.id}">${p.tipo ?? 'Publicação'} · ${p.tribunal ?? ''}</button></h3>
          <p class="card__sub">${p.orgao ?? ''} · disponibilizada em ${dataBR(p.data_disponibilizacao)}${p.classe ? ` · ${p.classe}` : ''}</p></div>
          <span class="selo ${TOM[p.situacao]}"><i></i>${p.situacao}</span></header>
        <div class="flex" style="margin-bottom:10px"><span class="mono-sm">${mascara(p.numero_processo ?? '')}</span>
          ${p.processo_id ? html`<a class="pchip" href="#/projetos/${p.projeto_id}/processos"><i></i><span class="tk-ellip">${p.projeto}</span></a>` : html`<span class="selo aviso">processo não cadastrado</span>`}
          ${p.oabs.map((o) => html`<span class="selo info">${o}</span>`)}</div>
        <p class="pub-texto" data-texto>${p.texto.length > 420 ? `${p.texto.slice(0, 420)}…` : p.texto}</p>
        ${p.texto.length > 420 ? html`<button type="button" class="link" data-mais="${p.id}">Abrir intimação completa e analisar</button>` : ''}
        ${p.observacao ? html`<p class="dica">Observação: ${p.observacao}${p.tratada_por_nome ? ` — ${p.tratada_por_nome}` : ''}</p>` : ''}
        ${gere ? html`<div class="flex mt">
          <button type="button" class="btn btn--accent" data-detalhar="${p.id}">Abrir intimação</button><button type="button" class="btn btn--ghost" data-agendar="${p.id}">${p.prazo_id?'Ver prazo agendado':'Agendar manualmente no Nexus'}</button>
          ${p.situacao !== 'lida' && p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="lida">Marcar como lida</button>` : ''}
          ${p.situacao !== 'tratada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="tratada">Tratada</button>` : html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="nova">Reabrir</button>`}
          ${p.situacao !== 'descartada' ? html`<button type="button" class="btn btn--ghost" data-sit="${p.id}" data-v="descartada">Descartar</button>` : ''}
          ${p.link ? html`<a class="btn btn--ghost" href="${p.link}" target="_blank" rel="noopener noreferrer">${icone('arrowUpRight')}Diário</a>` : ''}</div>` : ''}</article>`)
      : html`<section class="card glass up">${vazio('inbox', oabs.length ? 'Nenhuma publicação neste filtro' : 'Nenhuma OAB cadastrada', oabs.length ? 'Use "Buscar agora" ou troque o filtro. A busca automática roda a cada hora.' : 'Cadastre as OABs dos sócios; o sistema busca no DJEN e traz as publicações para cá.', gere && !oabs.length ? '<button class="btn btn--accent" data-oabs>Cadastrar OABs</button>' : '')}</section>`}</div><div class="flex mt"><button class="btn btn--ghost" type="button" data-pub-anterior ${pagina===1?'disabled':''}>Página anterior</button><span class="dica">Página ${pagina}</span><button class="btn btn--ghost" type="button" data-pub-proxima ${lista.publicacoes.length<200?'disabled':''}>Próxima página</button></div>`,
    depois(el) {
      ouvir(el, 'click', '[data-astrea-vincular]', async (b) => {
        const item = pendentes.find((p) => p.id === b.dataset.astreaVincular);
        try {
          const projetos = (await api.get('/api/projetos')).filter((p) => p.situacao !== 'encerrado');
          if (!projetos.length) return toast('Cadastre o projeto correto antes de vincular este processo.', 'aviso');
          const ok = await formulario({
            titulo: 'Vincular processo do Astrea',
            subtitulo: `${item.numero_processo} · ${item.prazos.length} prazo(s) confirmados no Astrea`,
            rotulo: 'Vincular e importar',
            campos: [
              { nome: 'projetoId', rotulo: 'Projeto / cliente', tipo: 'select', obrigatorio: true,
                opcoes: [{ v: '', t: 'Selecione o projeto correto' }, ...projetos.map((p) => ({ v: p.id, t: p.cliente ? `${p.nome} · ${p.cliente}` : p.nome }))] },
              { nome: 'segredoJustica', rotulo: 'Segredo de justiça se o processo for novo', tipo: 'select', obrigatorio: true,
                dica: 'Para processos já cadastrados, vale a configuração atual.',
                opcoes: [{ v: '', t: 'Selecione' }, { v: 'sim', t: 'Sim' }, { v: 'nao', t: 'Não' }] },
            ],
            async enviar(v) {
              const r = await api.post(`/api/controladoria/prazos-astrea/${item.id}/vinculo`, {
                projetoId: v.projetoId, segredoJustica: v.segredoJustica === 'sim',
              });
              toast(`${r.recebidos} prazo(s) do Astrea vinculados ao projeto.`);
            },
          });
          if (ok) navegar();
        } catch (e) { erroDe(e); }
      });
      const selecionadas=()=>[...el.querySelectorAll('[data-pubsel]:checked')].map(b=>b.dataset.pubsel);
      const nsel=()=>{const slot=el.querySelector('[data-nsel]');if(slot)slot.textContent=`${selecionadas().length} selecionadas`;};
      ouvir(el,'change','[data-pubsel]',nsel);
      ouvir(el,'change','[data-todas-pub]',b=>{el.querySelectorAll('[data-pubsel]').forEach(c=>c.checked=b.checked);nsel();});
      ouvir(el,'click','[data-lote-ler]',async(b)=>{const ids=selecionadas();if(!ids.length)return toast('Selecione as publicações.','aviso');b.disabled=true;try{for(const id of ids)await api.patch(`/api/controladoria/publicacoes/${id}`,{situacao:'lida'});toast(`${ids.length} publicações marcadas como lidas`);navegar();}catch(e){b.disabled=false;erroDe(e);}});
      ouvir(el,'click','[data-lote-abrir]',async()=>{const ids=selecionadas();if(!ids.length)return toast('Selecione as publicações.','aviso');for(const id of ids){try{await abrirPublicacao(id);}catch(e){erroDe(e);break;}}});
      ouvir(el,'click','[data-pub-anterior]',()=>{pagina=Math.max(1,pagina-1);navegar();});
      ouvir(el,'click','[data-pub-proxima]',()=>{pagina++;navegar();});
      el.querySelector('[data-busca-pub]').addEventListener('submit',e=>{e.preventDefault();consulta=e.target.elements.q.value.trim();oabFiltro=e.target.elements.oab.value;pagina=1;navegar();});
      el.querySelector('[data-periodo]').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; if (f.elements.fim.value < f.elements.inicio.value) return toast('O fim do período deve ser após o início.', 'erro'); pagina=1;periodoInicio = f.elements.inicio.value; periodoFim = f.elements.fim.value; historico = false; navegar(); });
      ouvir(el, 'click', '[data-hoje]', () => { periodoInicio = periodoFim = hojeISO(); historico = false; navegar(); });
      ouvir(el, 'click', '[data-historico]', () => { historico = true; navegar(); });
      ouvir(el,'click','[data-agendar]',async(b)=>{try{const p=await api.get(`/api/controladoria/publicacoes/${b.dataset.agendar}/detalhe`);if(p.prazo_id)return abrirPublicacao(p.id);if(await agendarPublicacaoManual(p))navegar();}catch(e){erroDe(e);}});
      ouvir(el, 'click', '[data-filtro]', (b) => { filtro = b.dataset.filtro; pagina=1;navegar(); });
      ouvir(el, 'click', '[data-sync]', async (b) => {
        b.disabled = true; b.textContent = 'Buscando no DJEN…';
        try { const r2 = await api.post('/api/controladoria/sincronizacao', {}); const falhas = r2.resultados.filter((x) => x.erro); toast(falhas.length ? `Busca com falhas: ${falhas[0].erro}` : `${r2.novas} publicação(ões) nova(s)`, falhas.length ? 'aviso' : 'ok'); navegar(); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      ouvir(el, 'click', '[data-oabs]', () => gerirOabs(oabs));
      ouvir(el, 'click', '[data-confronto]', () => confrontarComAstrea());
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
    corpo:html`<div class="pub-reader"><section><div class="flex"><span class="selo info">${p.projeto??'Processo ainda sem projeto vinculado'}</span>${p.prazo_id?html`<span class="selo ok">Prazo já agendado</span>`:''}</div>${gere&&!p.prazo_id?html`<button class="btn btn--accent mt" type="button" data-manual-independente>${p.projeto_id?'Agendar prazo manualmente':'Vincular projeto e agendar'}</button><p class="dica">O agendamento manual funciona sem aguardar a IA. Ele cria o prazo e as tarefas no Nexus.</p>`:''}<h3>Inteiro teor</h3><div class="pub-reader__text">${p.texto_legivel??p.texto}</div><p class="dica">Texto exibido sem marcação HTML. O conteúdo original permanece preservado na base.</p>${p.link?html`<a class="btn btn--ghost" href="${p.link}" target="_blank" rel="noopener noreferrer">Conferir no Diário</a>`:''}</section><aside class="pub-reader__analysis"><h3>Análise da intimação</h3><p class="dica">A tarefa de analisar a intimação e o prazo processual são registros separados. O agendamento depende da sua confirmação.</p><button class="btn btn--accent" type="button" data-analisar>${icone('search')}Analisar e sugerir prazo</button><div data-resultado aria-live="polite"></div></aside></div>`,
    acoes:[{id:'fechar',rotulo:'Fechar'}],aoAbrir(el){
      el.addEventListener('acao',()=>el.fechar(true));
      el.querySelector('[data-manual-independente]')?.addEventListener('click',async()=>{try{if(await agendarPublicacaoManual(p)){el.fechar(true);navegar();}}catch(e){el.erro(e.message);}});
      const analisar=async()=>{
        const button=el.querySelector('[data-analisar]');const slot=el.querySelector('[data-resultado]');button.disabled=true;button.textContent='Lendo a publicação…';
        try{
          const result=await api.post(`/api/controladoria/publicacoes/${id}/analise`,{});if(!el.isConnected)return;
          const sug=result.sugestao;
          slot.innerHTML=String(html`<p class="selo ${result.fonte==='ia_local'?'info':'aviso'}">${result.fonte==='ia_local'?`IA local · ${result.modelo}`:'Extração literal, sem leitura de IA'}</p>${result.resumo?html`<h4>Resumo sugerido pela IA</h4><p>${result.resumo}</p>`:''}${result.avisoIA?html`<p class="dica">${result.avisoIA}</p>`:''}${sug?html`<h4>Prazo expresso identificado</h4><p><b>${sug.dias} dias ${sug.regime==='uteis'?'úteis':'corridos'}</b> · vencimento preliminar <b>${dataBR(sug.calculo.vencimento)}</b></p><blockquote>${sug.trecho}</blockquote><p class="dica">Publicação considerada: ${dataBR(sug.calculo.publicacao)} · primeiro dia contado: ${dataBR(sug.calculo.primeiroDiaContado)}.</p>`:html`<p class="selo aviso">Sem prazo único seguro para agendamento rápido.</p>`}<ul class="dica">${result.ressalvas.map(r=>html`<li>${r}</li>`)}</ul>${gere&&sug&&!p.prazo_id?html`<p class="dica">Ao confirmar, você declara que conferiu o termo inicial e o calendário aplicável. Será criado o prazo processual com uma tarefa de cumprimento; a análise da intimação será concluída.</p><button class="btn btn--accent" type="button" data-confirmar-prazo ${!p.projeto_id?'disabled':''}>Confirmar ${sug.dias} dias ${sug.regime==='uteis'?'úteis':'corridos'} e agendar</button>`:''}${gere&&!p.prazo_id?html`<button class="btn btn--ghost mt" type="button" data-ajustar-prazo>Revisar dias e feriados locais</button>`:''}${!p.projeto_id?html`<p class="dica">Cadastre e vincule este processo a um projeto para agendar.</p>`:''}`);
          slot.querySelector('[data-confirmar-prazo]')?.addEventListener('click',async(e)=>{
            const b=e.currentTarget;b.disabled=true;
            try{const r=await api.post(`/api/controladoria/publicacoes/${id}/agendamento`,{titulo:`Providência processual · ${mascara(p.numero_processo??'')}`,dias:sug.dias,regime:sug.regime,feriadosLocais:[]});toast(r.repetido?'Este prazo já estava agendado':'Prazo processual e tarefa agendados');el.fechar(true);navegar();}catch(error){b.disabled=false;el.erro(error.message);}
          });
          slot.querySelector('[data-ajustar-prazo]')?.addEventListener('click',async()=>{try{if(await agendarPublicacaoManual(p,sug)){el.fechar(true);navegar();}}catch(e){el.erro(e.message);}});
        }catch(error){if(el.isConnected)el.erro(error.message);}finally{if(el.isConnected){button.disabled=false;button.textContent='Analisar novamente';}}
      };
      el.querySelector('[data-analisar]').addEventListener('click',analisar);
      // Open with the available suggestion; manual scheduling stays usable while AI responds.
      if(gere&&!p.prazo_id)void analisar();
    }});
}


/** Manual path stays available before/without an AI response. */
export async function agendarPublicacaoManual(p,sug){
  if(!p.projeto_id){
    const projects=(await api.get('/api/projetos')).filter(x=>x.situacao!=='encerrado');
    if(!projects.length){toast('Crie o projeto correto antes de vincular esta publicação.','aviso');return false;}
    const linked=await formulario({titulo:'Vincular publicação ao projeto',subtitulo:`Processo ${mascara(p.numero_processo??'')} · escolha o cliente correto`,rotulo:'Confirmar vínculo',campos:[{nome:'projetoId',rotulo:'Projeto / cliente',tipo:'select',obrigatorio:true,opcoes:[{v:'',t:'Selecione o projeto correto'},...projects.map(x=>({v:x.id,t:x.nome}))]}],enviar:async(v)=>{const next=await api.post(`/api/controladoria/publicacoes/${p.id}/vinculo`,{projetoId:v.projetoId});Object.assign(p,next);return true;}});
    if(!linked)return false;
  }
  return formulario({titulo:'Agendar prazo no Nexus',subtitulo:`${p.projeto} · disponibilização ${dataBR(p.data_disponibilizacao)}. Confirme os dias, o regime e os feriados.`,rotulo:'Confirmar e agendar',campos:[{nome:'titulo',rotulo:'Providência',obrigatorio:true,valor:`Providência processual · ${mascara(p.numero_processo??'')}`},{nome:'dias',rotulo:'Quantidade de dias',tipo:'number',min:1,obrigatorio:true,valor:sug?.dias},{nome:'regime',rotulo:'Contagem',tipo:'select',valor:sug?.regime??'uteis',opcoes:[{v:'uteis',t:'Dias úteis'},{v:'corridos',t:'Dias corridos'}]},{nome:'feriados',rotulo:'Feriados locais',dica:'Datas AAAA-MM-DD separadas por vírgulas; confira suspensões e o termo inicial.'}],enviar:async(v)=>{const dates=(v.feriados??'').split(',').map(d=>d.trim()).filter(Boolean);if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)))throw new Error('Informe feriados no formato AAAA-MM-DD.');const r=await api.post(`/api/controladoria/publicacoes/${p.id}/agendamento`,{titulo:v.titulo,dias:v.dias,regime:v.regime,feriadosLocais:dates});toast(r.repetido?'O prazo já estava agendado':'Prazo e tarefa de cumprimento criados no Nexus');return true;}});
}

/** Confronta a base do Astrea (planilha "Processos") com o Nexus: cria projetos por etiqueta, vincula processos a projetos e publicações a processos. */
async function confrontarComAstrea() {
  const linha = (r, t, v, tom = '') => `<li><div><b>${t}</b></div><div class="fim"><span class="selo ${tom}">${v}</span></div></li>`;
  const painel = (r) => `<ul class="lista">${linha(r, 'Registros na planilha', r.planilha.registros)}${linha(r, 'Clientes (etiquetas)', r.planilha.clientes)}${linha(r, 'Processos com número CNJ válido', r.planilha.processosComCnj)}
    ${linha(r, r.aplicado ? 'Projetos criados' : 'Projetos a criar', r.projetosCriados, 'info')}${linha(r, r.aplicado ? 'Processos novos' : 'Processos a cadastrar', r.processosNovos, 'info')}
    ${linha(r, r.aplicado ? 'Processos vinculados ao projeto' : 'Processos soltos a vincular ao projeto', r.processosVinculadosAProjeto, 'ok')}
    ${r.aplicado ? linha(r, 'Publicações ligadas ao processo agora', r.publicacoes.vinculadasAoProcesso, 'ok') + linha(r, 'Publicações ainda sem processo cadastrado', r.publicacoes.semProcesso, r.publicacoes.semProcesso ? 'aviso' : 'ok') + linha(r, 'Publicações com processo mas sem projeto', r.publicacoes.semProjeto, r.publicacoes.semProjeto ? 'aviso' : 'ok') : ''}
    ${linha(r, r.aplicado ? 'Sem etiqueta ligados pelo nome do cliente (registros)' : 'Sem etiqueta que herdam o projeto pelo nome do cliente', r.vinculadosPeloNomeDoCliente.registros, 'ok')}
    ${linha(r, 'Sem etiqueta de cliente (total na planilha)', r.planilha.semEtiqueta, r.planilha.semEtiqueta ? 'aviso' : '')}${linha(r, 'Sem número CNJ válido (só ficam no registro)', r.planilha.semCnj, r.planilha.semCnj ? 'aviso' : '')}</ul>`;
  let arquivo = null;
  await modal({
    titulo: 'Confrontar com a base do Astrea', subtitulo: 'Envie a planilha “Processos” exportada do Astrea. Primeiro mostro o que mudaria; só aplico quando você confirmar.', largo: true,
    corpo: `<label class="drop" id="cf-drop" tabindex="0"><input type="file" id="cf-arq" accept=".xlsx" hidden>${String(icone('upload'))}<b>Selecione a planilha .xlsx</b><small>A leitura é feita no servidor; nada é gravado antes da sua confirmação.</small></label><div id="cf-res" style="margin-top:14px"></div>`,
    acoes: [{ id: 'fechar', rotulo: 'Fechar' }, { id: 'vincular', rotulo: 'Só ligar publicações aos processos' }, { id: 'aplicar', rotulo: 'Aplicar vinculação', tipo: 'primario' }],
    aoAbrir(m) {
      const res = m.querySelector('#cf-res'); const entrada = m.querySelector('#cf-arq'); const aplicar = m.querySelector('[data-acao=aplicar]'); aplicar.disabled = true;
      const enviar = async (sim) => { const fd = new FormData(); fd.append('planilha', arquivo); fd.append('aplicar', sim ? 'sim' : 'nao'); return api.enviar('/api/controladoria/confronto', fd); };
      m.querySelector('#cf-drop').addEventListener('click', () => entrada.click());
      entrada.addEventListener('change', async () => {
        arquivo = entrada.files[0]; if (!arquivo) return; res.innerHTML = '<p class="dica">Lendo a planilha…</p>';
        try { const r = await enviar(false); res.innerHTML = `<h3 class="mini-h">O que mudaria</h3>${painel(r)}`; aplicar.disabled = false; } catch (e) { res.innerHTML = `<p class="nota">${esc(e.message)}</p>`; }
      });
      m.addEventListener('acao', async (e) => {
        if (e.detail.id === 'fechar') return m.fechar(true);
        if (e.detail.id === 'vincular') { try { const r = await api.post('/api/controladoria/confronto', {}); res.innerHTML = `<h3 class="mini-h">Resultado</h3><ul class="lista">${linha(r, 'Publicações ligadas ao processo', r.vinculadasAoProcesso, 'ok')}${linha(r, 'Ainda sem processo cadastrado', r.semProcesso, r.semProcesso ? 'aviso' : 'ok')}${linha(r, 'Com processo mas sem projeto', r.semProjeto, r.semProjeto ? 'aviso' : 'ok')}</ul>`; } catch (er) { erroDe(er); } return; }
        if (!arquivo) return; aplicar.disabled = true; aplicar.textContent = 'Aplicando…';
        try { const r = await enviar(true); res.innerHTML = `<h3 class="mini-h">Aplicado</h3>${painel(r)}`; aplicar.textContent = 'Aplicado'; toast('Base do Astrea confrontada e vinculada.'); } catch (er) { aplicar.disabled = false; aplicar.textContent = 'Aplicar vinculação'; erroDe(er); }
      });
    },
  });
  navegar();
}
