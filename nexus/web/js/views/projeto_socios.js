/** Patrimônio dos sócios: quem são (QSA), o que têm, o que está onerado e quem avalizou dívida da empresa. */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { html, icone, ouvir, reais } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';

const NATUREZAS = [['imovel', 'Imóvel'], ['veiculo', 'Veículo'], ['participacao', 'Participação societária'], ['aplicacao', 'Aplicação ou conta'], ['rural', 'Imóvel ou bem rural'], ['outro', 'Outro bem'], ['sem_bens', 'Nenhum bem (declarado)']];
const SIT = { critico: ['erro', 'Avalista com bens'], atencao: ['aviso', 'Bens onerados'], levantar: ['info', 'Bens a levantar'], sem_risco_aparente: ['ok', 'Sem risco aparente'] };
const TOM = { erro: 'erro', aviso: 'aviso', info: 'info' };
const valorEmReais = (t) => { if (!t) return null; const n = Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

export async function secaoSocios(ctx) {
  const escreve = pode('analise.executar');
  const { bens, quadro: q } = await api.get(`/api/projetos/${ctx.id}/socios`);
  const kpi = (rot, val, tom = '') => html`<div class="kpi card glass ${tom}"><small>${rot}</small><b>${val}</b></div>`;
  return {
    html: html`<section class="card glass up" data-socios><header class="card__head"><div><h2 class="card__title">Patrimônio dos sócios</h2>
        <p class="card__sub">Quem são os sócios, o que têm em nome próprio e quem garantiu dívida da empresa. Entra no relatório.</p></div>
        ${escreve ? html`<div class="nx-acts"><button class="btn btn--ghost btn--sm" data-qsa>${icone('users')}Buscar sócios na Receita</button><button class="btn btn--accent btn--sm" data-bem>${icone('plus')}Registrar bem</button></div>` : ''}</header>
      ${q.socios.length ? html`<div class="kpis">${kpi('Sócios', q.socios.length)}${kpi('Patrimônio informado', `R$ ${reais(q.total)}`)}${kpi('Com ônus', `R$ ${reais(q.onerado)}`, q.onerado ? 'alerta' : '')}${kpi('Avalistas/fiadores', q.garantidores, q.garantidores ? 'alerta' : '')}</div>
        ${q.alertas.length ? html`<ul class="lista mt">${q.alertas.map((a) => html`<li><span class="selo ${TOM[a.tom]}">${a.tom === 'erro' ? 'urgente' : a.tom === 'aviso' ? 'atenção' : 'nota'}</span><div><b>${a.titulo}</b><small>${a.detalhe}</small></div></li>`)}</ul>` : ''}
        <div class="socios-grid mt">${q.socios.map((s) => html`<article class="socio-card card glass"><header><div><b>${s.socio}</b><small>${s.qualificacao ?? 'sócio'}${s.garantidor ? ' · avalista/fiador' : ''}</small></div><span class="selo ${SIT[s.situacao][0]}">${SIT[s.situacao][1]}</span></header>
            ${s.bens ? html`<p class="socio-card__total">R$ ${reais(s.total)}${s.onerado ? html` <small>· R$ ${reais(s.onerado)} com ônus</small>` : ''}</p>
              <ul class="socio-card__bens">${bens.filter((b) => b.socio.toUpperCase() === s.socio.toUpperCase() && b.natureza !== 'sem_bens').map((b) => html`<li><span>${NATUREZAS.find(([n]) => n === b.natureza)?.[1]}</span><span>${b.descricao}${b.onus ? html` <em class="selo aviso">${b.onus}</em>` : ''}</span><span class="mono-sm">${b.valor === null ? 'sem valor' : `R$ ${reais(b.valor)}`}</span>${escreve ? html`<button class="ibtn ibtn--sm" data-del-bem="${b.id}" aria-label="Excluir bem">${icone('trash')}</button>` : ''}</li>`)}</ul>`
              : html`<p class="dica">Nenhum bem registrado. Peça a declaração de bens do IRPF, matrículas e CRLV.</p>`}
            ${escreve ? html`<button class="link" data-bem data-socio="${s.socio}">+ bem de ${s.socio.split(' ')[0]}</button>` : ''}</article>`)}</div>`
        : vazio('users', 'Nenhum sócio mapeado', escreve ? 'Busque os sócios no quadro societário da Receita (pelo CNPJ do cliente) ou registre os bens à mão.' : 'Ainda não há sócios registrados neste projeto.')}</section>`,
    depois(el) {
      ouvir(el, 'click', '[data-qsa]', async (b) => {
        b.disabled = true;
        try { const r = await api.post(`/api/projetos/${ctx.id}/socios/qsa`, {}); toast(r.novos ? `${r.novos} sócio(s) trazido(s) da Receita` : 'Nenhum sócio novo no quadro societário', r.novos ? 'ok' : 'aviso'); if (r.avisos.length) toast(r.avisos.join(' · '), 'aviso', 8000); ctx.recarregar(); }
        catch (e) { b.disabled = false; erroDe(e); }
      });
      ouvir(el, 'click', '[data-bem]', async (b) => {
        const ok = await formulario({ titulo: 'Registrar bem de sócio', subtitulo: 'Informe a fonte (IRPF, matrícula, CRLV). Valor em branco fica como "não informado".', rotulo: 'Registrar', largo: true, campos: [
          { nome: 'socio', rotulo: 'Sócio', obrigatorio: true, valor: b.dataset.socio ?? '', metade: true },
          { nome: 'documento', rotulo: 'CPF (opcional)', metade: true },
          { nome: 'natureza', rotulo: 'Tipo do bem', tipo: 'select', valor: 'imovel', opcoes: NATUREZAS.map(([v, t]) => ({ v, t })), metade: true },
          { nome: 'valor', rotulo: 'Valor (R$)', placeholder: '350.000,00', metade: true },
          { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, placeholder: 'Apartamento matrícula 12.345, 2º RI de Curitiba' },
          { nome: 'onus', rotulo: 'Ônus (se houver)', placeholder: 'Alienação fiduciária ao Banco X', metade: true },
          { nome: 'garantidor', rotulo: 'É avalista ou fiador da empresa?', tipo: 'select', valor: 'nao', opcoes: [{ v: 'nao', t: 'Não' }, { v: 'sim', t: 'Sim' }], metade: true },
          { nome: 'referencia', rotulo: 'Fonte', placeholder: 'IRPF 2025, p. 4' }],
          async enviar(v) { await api.post(`/api/projetos/${ctx.id}/socios`, { socio: v.socio, documento: v.documento, natureza: v.natureza, descricao: v.descricao, valor: valorEmReais(v.valor), onus: v.onus, garantidor: v.garantidor === 'sim', referencia: v.referencia }); } });
        if (ok) { toast('Bem registrado'); ctx.recarregar(); }
      });
      ouvir(el, 'click', '[data-del-bem]', async (b) => {
        if (!(await confirmar('Excluir este bem?', 'Ele sai do quadro e da próxima versão do relatório.', { rotulo: 'Excluir', perigo: true }))) return;
        try { await api.del(`/api/socios/${b.dataset.delBem}`); ctx.recarregar(); } catch (e) { erroDe(e); }
      });
    },
  };
}
