/**
 * As ferramentas do NGA LAB, com o estado real de cada uma.
 *
 * O servidor sonda cada aplicação (1,5 s de limite) e cruza com o uso da
 * credencial de integração. Nada aqui é decorativo: "no ar" significa que a
 * aplicação respondeu agora; "ligada ao Lab" significa que ela já entregou algo
 * pela API de integração.
 */
import { api } from '../api.js';
import { html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, toast, vazio } from '../ui.js';
import { ir, navegar } from '../shell.js';

const ICONE = { prazos: 'calendar', sentinela: 'radar', integra: 'file', radar: 'target', relatorios: 'chart' };
const ESTADO = { em_uso: ['ok', 'Em uso'], em_desenvolvimento: ['aviso', 'Em desenvolvimento'], planejada: ['info', 'Planejada'] };

export default async function ferramentas({ id }) {
  const r = await api.get('/api/ferramentas');
  if (id) return embutida(r.ferramentas.find((f) => f.id === id));
  const noAr = r.ferramentas.filter((f) => f.noAr).length;
  return {
    titulo: 'Ferramentas',
    html: html`${cabecalho({
      titulo: 'Ferramentas', sub: `As aplicações do ecossistema NGA LAB · verificado ${relativo(r.verificadoEm)}`,
      acoes: html`<button type="button" class="btn btn--ghost" data-act="rever">${icone('refresh')}Verificar de novo</button>`,
      resumo: [{ rotulo: 'No ar', valor: noAr }, { rotulo: 'Ligadas ao Lab', valor: r.ferramentas.filter((f) => f.ligadaAoLab).length }, { rotulo: 'Total', valor: r.ferramentas.length }],
    })}
    <div class="grid2 mt">${r.ferramentas.map((f) => {
      const [tom, rot] = ESTADO[f.estado] ?? ['info', f.estado];
      return html`<section class="card glass up tool"><div class="tool__top"><span class="tool__ico">${icone(ICONE[f.id] ?? 'bolt')}</span><div><h3>${f.nome}</h3>
        <div class="tool__st"><span class="selo ${f.noAr ? 'ok' : f.semInterface ? 'info' : 'erro'}"><i></i>${f.noAr ? `No ar · ${f.latenciaMs} ms` : f.semInterface ? 'Sem interface' : 'Fora do ar'}</span><span class="selo ${tom}">${rot}</span></div></div></div>
        <p>${f.descricao}</p>
        <p class="mono-sm">${f.independente ? 'Independente: login e dados próprios (Supabase), sem entrega ao Lab' : f.ligadaAoLab ? `Ligada ao Lab · ${f.entregas} entrega(s)${f.ultimaEntrega ? ` · última ${relativo(f.ultimaEntrega)}` : ''}`
          : f.credencialCriada ? 'Credencial criada, ainda sem entregas' : 'Ainda não entrega dados ao Lab'}</p>
        <div class="tool__acts">${f.noAr ? (f.semIncorporar
          ? html`<a class="btn btn--accent" href="${f.caminho ?? f.url}" target="_blank" rel="noopener">${icone('arrowUpRight')}Abrir</a>`
          : html`<button type="button" class="btn btn--accent" data-embutir="${f.id}">${icone('expand')}Abrir aqui</button>
          <a class="btn btn--ghost" href="${f.caminho ?? f.url}" target="_blank" rel="noopener">${icone('arrowUpRight')}Nova aba</a>`) : f.semInterface ? html`<span class="dica">Roda agendada; o resultado chega pela integração.</span>` : html`<span class="dica">Inicie a aplicação em ${f.url ?? 'sua máquina'} para abrir.</span>`}</div></section>`;
    })}</div>`,
    depois(el) {
      ouvir(el, 'click', '[data-embutir]', (b) => ir(`ferramentas/${b.dataset.embutir}`));
      ouvir(el, 'click', '[data-act=rever]', () => { toast('Verificando…'); navegar(); });
    },
  };
}

function embutida(f) {
  if (!f) return { titulo: 'Ferramenta', html: html`<section class="card glass">${vazio('search', 'Ferramenta não encontrada', 'Ela não está no catálogo do Lab.')}</section>` };
  return {
    titulo: f.nome,
    html: html`<a class="crumb up" href="#/ferramentas">${icone('chevronLeft')}Ferramentas</a>
      ${cabecalho({ titulo: f.nome, sub: f.descricao, acoes: f.url ? html`<a class="btn btn--ghost" href="${f.caminho ?? f.url}" target="_blank" rel="noopener">${icone('arrowUpRight')}Abrir em nova aba</a>` : '' })}
      ${f.semIncorporar ? html`<section class="card glass mt up">${vazio('lock', 'Esta ferramenta abre em outra aba', `${f.nome} tem login próprio e não aceita ser exibida dentro de outra página (proteção contra clickjacking). Use “Abrir em nova aba”.`)}</section>`
        : f.noAr ? html`<iframe class="frame mt up" src="${f.caminho ?? f.url}" title="${f.nome}" referrerpolicy="no-referrer"></iframe>
        <p class="dica mt">Se o quadro acima ficar em branco, a ferramenta impede ser exibida dentro de outra página. Use “Abrir em nova aba”.</p>`
        : html`<section class="card glass mt up">${vazio('alert', 'Fora do ar', `${f.nome} não respondeu. Inicie a aplicação e tente de novo.`)}</section>`}`,
  };
}
