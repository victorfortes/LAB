/** Ajustes: a conta, as integrações (credenciais) e o estado real do sistema. */
import { api } from '../api.js';
import { estado, pode, ROTULO_DO_PAPEL } from '../estado.js';
import { html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast } from '../ui.js';
import { navegar } from '../shell.js';

const ESCOPOS = { 'processos': ['processos'], 'prazos': ['prazos'], 'documentos': ['documentos'], 'processos+documentos': ['processos', 'documentos'], 'todos': ['processos', 'prazos', 'documentos'] };

export default async function ajustes() {
  const eu = estado.eu;
  const gere = pode('integracao.gerir');
  const [int, ia, arq] = await Promise.all([
    gere ? api.get('/api/integracoes') : null, api.get('/api/ia/estado').catch(() => null), api.get('/api/arquivos/estado').catch(() => null)]);
  return {
    titulo: 'Ajustes',
    html: html`${cabecalho({ titulo: 'Ajustes', sub: 'Conta, integrações e o que está de fato funcionando' })}
      <div class="grid-hub mt">
        <div style="display:grid;gap:var(--gap)">
          ${gere ? html`<section class="card glass up"><header class="card__head"><div><h2 class="card__title">Integrações</h2><p class="card__sub">Credenciais para as aplicações do Lab entregarem dados. O token aparece uma única vez.</p></div>
            <button type="button" class="btn btn--accent" data-nova>${icone('plus')}Nova credencial</button></header>
            ${int.integracoes.length ? html`<ul class="lista">${int.integracoes.map((i) => html`<li><div><b>${i.nome}</b><small>${i.aplicacao} · ${i.escopos.join(', ')} · ${i.nuncaUsada ? 'nunca usada' : `último uso ${relativo(i.ultimo_uso_em)} · ${i.usos} entrega(s)`}</small></div>
              <div class="fim">${i.ativa ? html`<button type="button" class="btn btn--ghost perigo-btn" data-revogar="${i.id}" data-n="${i.nome}">Revogar</button>` : html`<span class="selo erro">revogada</span>`}</div></li>`)}</ul>`
              : html`<p class="dica">Nenhuma credencial criada.</p>`}
            <h3 class="mini-h">Estado da ligação (declarado pelo servidor)</h3>
            <ul class="lista">${Object.entries(int.contrato.estado).map(([k, v]) => html`<li><div><b>${k}</b><small>${v}</small></div></li>`)}</ul>
            ${int.contrato.naoExercitado ? html`<p class="dica" style="margin-top:10px">${int.contrato.naoExercitado}</p>` : ''}</section>` : ''}
        </div>
        <div style="display:grid;gap:var(--gap)">
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sua conta</h2></div></header>
            <p><b>${eu.usuario.nome}</b><br><span class="mono-sm">${eu.usuario.email}</span></p>
            <p class="dica">${eu.papeis.map((p) => ROTULO_DO_PAPEL[p] ?? p).join(', ')} · ${eu.organizacoes.map((o) => o.nome).join(', ')}</p></section>
          <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Sistema</h2></div></header>
            <ul class="lista">
              <li><div><b>Leitura por IA</b><small>${ia ? (ia.disponivel ? 'Configurada' : ia.impedimento) : '—'}</small></div><div class="fim"><span class="selo ${ia?.disponivel ? 'ok' : 'aviso'}">${ia?.disponivel ? 'ativa' : 'desligada'}</span></div></li>
              <li><div><b>Armazenamento de arquivos</b><small>${arq ? (arq.descricao ?? arq.modo ?? JSON.stringify(arq).slice(0, 120)) : '—'}</small></div></li></ul></section>
        </div></div>`,
    depois(el) {
      ouvir(el, 'click', '[data-nova]', async () => {
        let r = null;
        await formulario({
          titulo: 'Nova credencial de integração', rotulo: 'Criar',
          campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, placeholder: 'Sentinela — escritório' }, { nome: 'aplicacao', rotulo: 'Aplicação', tipo: 'select', opcoes: [{ v: 'sentinela', t: 'NGA Sentinela' }, { v: 'integra', t: 'NGA Íntegra' }, { v: 'prazos', t: 'NGA Prazos' }, { v: 'outra', t: 'Outra' }] },
            { nome: 'escopos', rotulo: 'O que pode entregar', tipo: 'select', valor: 'processos', opcoes: Object.keys(ESCOPOS).map((k) => ({ v: k, t: k })) }],
          async enviar(v) { r = await api.post('/api/integracoes', { nome: v.nome, aplicacao: v.aplicacao, escopos: ESCOPOS[v.escopos] }); },
        });
        if (!r) return;
        await modal({ titulo: 'Credencial criada', subtitulo: r.nome,
          corpo: `<p class="dica">${r.aviso}</p><div class="senha-box"><small>Token</small><b class="mono-sm" style="word-break:break-all;color:var(--lab-amber-2)">${String(r.token).replace(/</g, '&lt;')}</b></div>`,
          acoes: [{ id: 'c', rotulo: 'Copiar token' }, { id: 'ok', rotulo: 'Já guardei', tipo: 'primario' }],
          aoAbrir(m) { m.addEventListener('acao', (e) => { if (e.detail.id === 'c') navigator.clipboard?.writeText(r.token).then(() => toast('Token copiado')); else m.fechar(true); }); } });
        navegar();
      });
      ouvir(el, 'click', '[data-revogar]', async (b) => {
        if (!(await confirmar('Revogar credencial?', `“${b.dataset.n}” deixa de funcionar na hora. A aplicação que a usa vai parar de entregar.`, { rotulo: 'Revogar', perigo: true }))) return;
        try { await api.del(`/api/integracoes/${b.dataset.revogar}`); toast('Credencial revogada'); navegar(); } catch (e) { erroDe(e); }
      });
    },
  };
}
