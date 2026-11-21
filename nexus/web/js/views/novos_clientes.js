/**
 * Novos clientes: o onboarding do escritório num caminho só e bem visual.
 *
 *   #/novos-clientes        quadro com cada cliente na sua etapa e o botão grande "Novo cliente (CNPJ)"
 *   #/novos-clientes/:id    a ficha do cliente: uma etapa por vez, sempre com UM botão de "próximo passo"
 *
 * Etapas: 1 Pré-diagnóstico · 2 Reunião inicial · 3 Proposta · 4 Contrato fechado (cria o projeto e dispara as
 * tarefas) · 5 Onboarding (acompanha as tarefas). Ao fechar o contrato, o escritório inteiro vê a comemoração.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataBR, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';
import { equipe as equipeDoEscritorio } from './tarefas.js';

const ETAPAS = [
  ['prediagnostico', 'Pré-diagnóstico', 'search', 'O sistema levanta cadastro, sócios e processos pelo CNPJ.'],
  ['reuniao', 'Reunião inicial', 'calendar', 'Marque e registre a primeira conversa com o cliente.'],
  ['proposta', 'Proposta', 'doc', 'Proposta enviada, aguardando a decisão do cliente.'],
  ['contrato', 'Contrato fechado', 'check', 'Ao confirmar, o projeto nasce e o onboarding começa sozinho.'],
  ['onboarding', 'Onboarding', 'flag', 'Tarefas de boas-vindas da equipe até o cliente estar rodando.'],
];
const ordem = (e) => ETAPAS.findIndex(([k]) => k === e);
const TIPOS = [['reestruturacao', 'Reestruturação'], ['recuperacao_judicial', 'Recuperação judicial'], ['recuperacao_extrajudicial', 'Recuperação extrajudicial'], ['contencioso_estrategico', 'Contencioso estratégico'],
  ['consultivo', 'Consultivo'], ['negociacao_credores', 'Negociação com credores'], ['investigacao_patrimonial', 'Investigação patrimonial'], ['protecao_patrimonial', 'Proteção patrimonial'], ['falencia', 'Falência']];
const AREAS = ['Empresarial', 'Cível', 'Trabalhista', 'Tributário', 'Criminal', 'Recuperação Judicial'];

export default async function novosClientes({ id } = {}) { return id ? ficha(id) : quadro(); }

async function novo() {
  let r;
  const ok = await formulario({ titulo: 'Novo cliente', subtitulo: 'Digite o CNPJ da empresa. O resto o sistema busca sozinho.', rotulo: 'Começar', campos: [
    { nome: 'cnpj', rotulo: 'CNPJ da empresa', placeholder: '00.000.000/0000-00', obrigatorio: false },
    { nome: 'nome', rotulo: 'Ou o nome (pessoa física ou sem CNPJ)', placeholder: 'Ex.: João da Silva' },
    { nome: 'origem', rotulo: 'Como chegou até nós (opcional)', placeholder: 'Indicação, site, parceiro…' }],
    async enviar(v) { const cnpj = (v.cnpj ?? '').replace(/\D/g, ''); if (!cnpj && !v.nome) throw new Error('Informe o CNPJ ou o nome.'); r = await api.post('/api/novos-clientes', { ...(cnpj ? { cnpj } : {}), ...(v.nome ? { nome: v.nome } : {}), origem: v.origem || undefined }); } });
  if (ok && r) ir(`novos-clientes/${r.id}`);
}

async function quadro() {
  const lista = await api.get('/api/novos-clientes');
  const ativos = lista.filter((n) => !['concluido', 'perdido'].includes(n.etapa));
  const escreve = pode('projeto.escrever');
  return {
    titulo: 'Novos clientes',
    html: html`${cabecalho({ titulo: 'Novos clientes', sub: 'Do CNPJ ao cliente rodando: pré-diagnóstico, reunião, contrato e onboarding, num caminho só.',
      acoes: escreve ? html`<button class="btn btn--accent nc-novo" data-novo>${icone('plus')}Novo cliente</button>` : '',
      resumo: ETAPAS.map(([k, t]) => ({ rotulo: t, valor: lista.filter((n) => n.etapa === k).length })) })}
      ${escreve ? html`<button type="button" class="nc-hero glass up mt" data-novo><span class="nc-hero__ico">${icone('plus')}</span><span><b>Chegou um cliente novo?</b><small>Clique aqui e digite o CNPJ. O sistema faz o pré-diagnóstico e guia cada passo.</small></span>${icone('chevron')}</button>` : ''}
      <div class="nc-colunas mt">${ETAPAS.map(([k, t, ic]) => { const daqui = ativos.filter((n) => n.etapa === k);
        return html`<section class="nc-col glass up"><header><span class="nc-col__ico">${icone(ic)}</span><b>${t}</b><em>${daqui.length}</em></header>
          ${daqui.length ? daqui.map((n) => html`<a class="nc-card" href="#/novos-clientes/${n.id}"><b>${n.nome}</b><small>${n.cnpj ? n.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'sem CNPJ'}</small>
              ${k === 'reuniao' && n.reuniaoEm ? html`<span class="selo info">${icone('calendar')}${dataBR(n.reuniaoEm)}</span>` : ''}${k === 'onboarding' ? html`<span class="nc-barra"><i style="width:${n.tarefas ? Math.round((n.feitas / n.tarefas) * 100) : 0}%"></i></span><small>${n.feitas} de ${n.tarefas} tarefas${n.area ? ` · ${n.area}` : ''}</small>` : ''}
              <small class="nc-quando">atualizado ${relativo(n.atualizadoEm)}</small></a>`) : html`<p class="nc-vazio">Nenhum</p>`}</section>`; })}</div>
      ${lista.filter((n) => n.etapa === 'concluido').length ? html`<details class="card glass up mt"><summary class="link">Clientes que já concluíram o onboarding (${lista.filter((n) => n.etapa === 'concluido').length})</summary><ul class="lista mt">${lista.filter((n) => n.etapa === 'concluido').map((n) => html`<li><div><b>${n.nome}</b><small>${n.area ?? ''} · contrato ${n.contratoEm ? dataBR(n.contratoEm) : ''}</small></div>${n.projetoId ? html`<a class="btn btn--ghost btn--sm" href="#/projetos/${n.projetoId}">Abrir projeto</a>` : ''}</li>`)}</ul></details>` : ''}`,
    depois(el) { ouvir(el, 'click', '[data-novo]', () => novo().catch(erroDe)); },
  };
}

async function ficha(id) {
  const n = await api.get(`/api/novos-clientes/${id}`);
  const k = n.etapa === 'perdido' ? -1 : n.etapa === 'concluido' ? ETAPAS.length : ordem(n.etapa);
  const escreve = pode('projeto.escrever');
  const proximo = {
    prediagnostico: [icone('calendar'), 'Marcar a reunião inicial', 'reuniao'],
    reuniao: n.reuniaoEm && !n.reuniaoRealizada ? [icone('check'), 'A reunião aconteceu: registrar', 'realizada'] : [icone('calendar'), 'Marcar a reunião inicial', 'reuniao'],
    proposta: [icone('check'), 'O cliente fechou: confirmar contrato', 'contrato'],
    contrato: [icone('check'), 'Confirmar contrato', 'contrato'],
    onboarding: [icone('folder'), 'Abrir o projeto do cliente', 'projeto'],
  }[n.etapa];
  const feitas = n.tarefas.filter((t) => t.status === 'concluida').length;
  return {
    titulo: n.nome,
    html: html`<p class="nx-trail"><a href="#/novos-clientes">Novos clientes</a></p>
      ${cabecalho({ titulo: n.nome, sub: html`${n.cnpj ? n.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'Sem CNPJ'}${n.origem ? ` · ${n.origem}` : ''}${n.etapa === 'perdido' ? ' · NÃO FECHOU' : ''}`,
        acoes: escreve && !['concluido', 'perdido'].includes(n.etapa) && !n.projetoId ? html`<button class="btn btn--ghost btn--sm" data-acao="perdido">Não fechou</button>` : '' })}
      <ol class="nc-passos up">${ETAPAS.map(([e, t, ic], i) => html`<li class="${i < k ? 'ok' : i === k ? 'agora' : ''}"><span class="nc-passos__ico">${i < k ? icone('check') : icone(ic)}</span><b>${t}</b><small>${i === k ? 'Você está aqui' : i < k ? 'Feito' : ''}</small></li>`)}</ol>
      ${proximo && escreve && n.etapa !== 'perdido' ? html`<section class="nc-agora glass up mt"><div><p class="eyebrow">Próximo passo</p><h2>${proximo[1]}</h2><p>${{ reuniao: 'Combine a primeira conversa com o cliente: data, hora e com quem.', realizada: 'Anote o que o cliente precisa e os próximos passos.', contrato: ETAPAS[3][3], projeto: ETAPAS[4][3] }[proximo[2]]}</p></div><button class="btn btn--accent nc-agora__btn" data-acao="${proximo[2]}">${proximo[0]}${proximo[1]}</button></section>` : ''}
      <div class="grid2 mt">
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Contato e reunião</h2></div>${escreve ? html`<button class="btn btn--ghost btn--sm" data-acao="contato">${icone('edit')}Editar</button>` : ''}</header>
          <dl class="nc-dl"><div><dt>Contato</dt><dd>${n.contatoNome ?? '—'}</dd></div><div><dt>E-mail</dt><dd>${n.contatoEmail ?? '—'}</dd></div><div><dt>Telefone</dt><dd>${n.contatoTelefone ?? '—'}</dd></div>
            <div><dt>Reunião inicial</dt><dd>${n.reuniaoEm ? `${new Date(n.reuniaoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${n.reuniaoRealizada ? ' · realizada' : ''}` : 'não marcada'}</dd></div></dl>
          ${n.reuniaoNotas ? html`<p class="dica"><b>Anotações:</b> ${n.reuniaoNotas}</p>` : ''}</section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">${n.projetoId ? 'Onboarding em andamento' : 'Contrato'}</h2></div></header>
          ${n.projetoId ? html`<p class="dica">${n.area ?? ''} · ${TIPOS.find(([v]) => v === n.tipoProjeto)?.[1] ?? ''} · contrato ${n.contratoEm ? dataBR(n.contratoEm) : ''}${n.honorarios ? ` · ${n.honorarios}` : ''}</p>
            <div class="nc-barra nc-barra--grande"><i style="width:${n.tarefas.length ? Math.round((feitas / n.tarefas.length) * 100) : 0}%"></i></div><p class="dica">${feitas} de ${n.tarefas.length} tarefas do onboarding concluídas</p>
            <ul class="lista">${n.tarefas.map((t) => html`<li><span class="selo ${t.status === 'concluida' ? 'ok' : ''}">${t.status === 'concluida' ? 'feito' : dataBR(t.prazo)}</span><div><b>${t.titulo}</b><small>${t.responsavel ?? ''}</small></div></li>`)}</ul>
            ${n.etapa === 'onboarding' && feitas === n.tarefas.length && escreve ? html`<button class="btn btn--accent mt" data-acao="concluir">${icone('check')}Concluir onboarding</button>` : ''}`
            : html`<p class="dica">Quando o cliente fechar, clique em "Confirmar contrato": o sistema cria o projeto na área certa, gera o checklist de documentos, dispara as tarefas de boas-vindas e avisa o escritório.</p>`}</section></div>
      ${n.prediagnosticoId ? html`<section class="mt"><h2 class="nc-h2">Pré-diagnóstico</h2><div data-pd-alvo><div class="skel" style="height:360px"></div></div></section>` : ''}`,
    async depois(el) {
      const rec = () => navegar();
      if (n.prediagnosticoId) { const { montarRelatorio } = await import('./prediagnostico.js'); try { montarRelatorio(el.querySelector('[data-pd-alvo]'), await api.get(`/api/prediagnosticos/${n.prediagnosticoId}`)); } catch (e) { erroDe(e); } }
      ouvir(el, 'click', '[data-acao]', async (b) => {
        const a = b.dataset.acao;
        try {
          if (a === 'projeto') return ir(`projetos/${n.projetoId}`);
          if (a === 'reuniao') { const ok = await formulario({ titulo: 'Reunião inicial', subtitulo: 'Quando vai ser a primeira conversa com o cliente?', rotulo: 'Marcar', campos: [{ nome: 'quando', rotulo: 'Data e hora', tipo: 'datetime-local', obrigatorio: true }, { nome: 'contato', rotulo: 'Com quem (nome do contato)', valor: n.contatoNome ?? '' }],
            async enviar(v) { await api.patch(`/api/novos-clientes/${id}`, { reuniaoEm: new Date(v.quando).toISOString(), contatoNome: v.contato || null }); } }); if (ok) { toast('Reunião marcada'); rec(); } }
          if (a === 'realizada') { const ok = await formulario({ titulo: 'Como foi a reunião?', rotulo: 'Registrar', campos: [{ nome: 'notas', rotulo: 'Anotações (o que o cliente precisa, próximos passos)', tipo: 'textarea' }],
            async enviar(v) { await api.patch(`/api/novos-clientes/${id}`, { reuniaoRealizada: true, reuniaoNotas: v.notas || null }); } }); if (ok) { toast('Reunião registrada'); rec(); } }
          if (a === 'contato') { const ok = await formulario({ titulo: 'Contato do cliente', rotulo: 'Salvar', campos: [{ nome: 'nome', rotulo: 'Nome', valor: n.contatoNome ?? '' }, { nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: n.contatoEmail ?? '', metade: true }, { nome: 'tel', rotulo: 'Telefone', valor: n.contatoTelefone ?? '', metade: true }],
            async enviar(v) { await api.patch(`/api/novos-clientes/${id}`, { contatoNome: v.nome || null, contatoEmail: v.email || null, contatoTelefone: v.tel || null }); } }); if (ok) rec(); }
          if (a === 'perdido') { const ok = await formulario({ titulo: 'O cliente não fechou', rotulo: 'Registrar', campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea' }], async enviar(v) { await api.patch(`/api/novos-clientes/${id}`, { etapa: 'perdido', motivoPerda: v.motivo || null }); } }); if (ok) rec(); }
          if (a === 'concluir') { await api.patch(`/api/novos-clientes/${id}`, { etapa: 'concluido' }); toast('Onboarding concluído'); rec(); }
          if (a === 'contrato') {
            const eq = (await equipeDoEscritorio()).filter((u) => !['financeiro', 'administrativo'].includes(u.papel));
            let r;
            const ok = await formulario({ titulo: 'Contrato fechado!', subtitulo: 'Diga para onde o cliente vai. O sistema cria o projeto e começa o onboarding.', rotulo: 'Confirmar contrato', campos: [
              { nome: 'area', rotulo: 'Área (equipe)', tipo: 'select', obrigatorio: true, valor: 'Empresarial', opcoes: AREAS.map((x) => ({ v: x, t: x })) },
              { nome: 'tipo', rotulo: 'Tipo de trabalho', tipo: 'select', obrigatorio: true, valor: 'reestruturacao', opcoes: TIPOS.map(([v, t]) => ({ v, t })) },
              { nome: 'resp', rotulo: 'Advogado responsável', tipo: 'select', obrigatorio: true, opcoes: eq.map((u) => ({ v: u.id, t: u.nome })) },
              { nome: 'honorarios', rotulo: 'Honorários combinados (opcional)', placeholder: 'Ex.: R$ 15.000 fixos + 3% de êxito' },
              { nome: 'data', rotulo: 'Data da assinatura', tipo: 'date', valor: new Date().toLocaleDateString('sv-SE') }],
              async enviar(v) { r = await api.post(`/api/novos-clientes/${id}/contrato`, { area: v.area, tipoProjeto: v.tipo, responsavelId: v.resp, honorarios: v.honorarios || null, contratoEm: v.data || undefined }); } });
            if (ok) { celebrar({ id: `local-${Date.now()}`, titulo: n.nome, area: r.area, responsavel: null }, true); toast(`Projeto criado, ${r.checklist} documento(s) no checklist e ${r.tarefas.length} tarefas de onboarding disparadas`); rec(); }
          }
        } catch (e) { erroDe(e); }
      });
    },
  };
}

/** Comemoração no canto inferior esquerdo (para todo o escritório). */
export function celebrar(c, local = false) {
  const vistos = JSON.parse(localStorage.getItem('nx-celebracoes') ?? '[]');
  if (!local && vistos.includes(c.id)) return;
  localStorage.setItem('nx-celebracoes', JSON.stringify([...vistos, c.id].slice(-50)));
  const el = document.createElement('div'); el.className = 'festa'; el.setAttribute('role', 'status');
  el.innerHTML = String(html`<div class="festa__confete" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => html`<i style="--i:${i}"></i>`)}</div>
    <span class="festa__ico">🎉</span><div><p class="festa__eyebrow">Novo cliente!</p><b>${c.titulo}</b><small>Chegou para a equipe <strong>${c.area ?? '—'}</strong>${c.responsavel ? ` · com ${c.responsavel}` : ''}${c.fechadoPor ? ` · contrato fechado por ${c.fechadoPor}` : ''}</small></div>
    <button type="button" class="ibtn ibtn--sm" aria-label="Fechar">${icone('x')}</button>`);
  document.body.append(el);
  const sai = () => { el.classList.add('sai'); setTimeout(() => el.remove(), 400); };
  el.querySelector('button').addEventListener('click', sai); setTimeout(sai, 12000);
}
export async function verificarCelebracoes() {
  try { const l = await api.get('/api/celebracoes'); for (const c of l.slice(0, 2).reverse()) celebrar(c); } catch { /* sem rede: tenta na próxima */ }
}
void confirmar; void vazio;
