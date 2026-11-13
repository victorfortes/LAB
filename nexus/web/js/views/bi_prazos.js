/**
 * BI de Prazos: o MESMO painel "Controle de prazos - NGA ADV" (Visão Geral, Prazos hoje, Próximos 7 dias,
 * Performance e Eventos, com o rodízio de abas), agora alimentado pelo banco do LAB.
 *
 * A automação diária do Astrea entrega a base em /api/integracao/agenda. A tela lê a cada 2 minutos.
 * "Tela cheia" deixa o painel rodando sozinho; "Link da TV" gera um endereço que abre o painel sem login
 * (credencial só de leitura do BI, revogável), para a TV do escritório não depender de sessão.
 */
import { api } from '../api.js';
import { pode } from '../estado.js';
import { dataHoraBR, html, icone, ouvir, relativo } from '../util.js';
import { cabecalho, confirmar, erroDe, formulario, modal, toast } from '../ui.js';
import { aoSair } from '../shell.js';

export default async function biPrazos() {
  const [d, cargas] = await Promise.all([api.get('/api/bi-prazos').catch(() => ({ rows: [], updatedAt: null })), api.get('/api/bi-prazos/historico').catch(() => [])]);
  const ultima = cargas[0];
  const atrasada = ultima && Date.now() - new Date(ultima.recebidoEm).getTime() > 30 * 3600_000;
  return {
    titulo: 'BI de Prazos',
    html: html`${cabecalho({ titulo: 'BI de Prazos', sub: ultima ? html`Base do Astrea recebida ${relativo(ultima.recebidoEm)} · ${d.rows.length} registros${atrasada ? ' · a automação não entrega há mais de 30 horas' : ''}` : 'Aguardando a primeira carga da automação do Astrea.',
      acoes: html`${pode('controladoria.gerir') ? html`<button class="btn btn--ghost" data-importar>${icone('upload')}Importar planilha do Astrea</button>` : ''}<button class="btn btn--accent" data-cheia>${icone('eye')}Tela cheia</button><button class="btn btn--ghost" data-tv>${icone('link')}Link da TV</button><button class="btn btn--ghost" data-cargas>${icone('refresh')}Cargas</button>`,
      resumo: [{ rotulo: 'Prazos', valor: d.rows.filter((r) => r.tipo === 'Prazo').length }, { rotulo: 'Eventos e audiências', valor: d.rows.filter((r) => r.tipo !== 'Prazo').length }, ...(atrasada ? [{ rotulo: 'Automação', valor: 'atrasada', tom: 'alert' }] : [])] })}
      <div class="bi-quadro mt" data-quadro><iframe title="Controle de prazos - NGA ADV" data-bi></iframe></div>`,
    depois(el) {
      const quadro = el.querySelector('[data-bi]');
      fetch('/bi-prazos-tv.html', { credentials: 'same-origin' }).then((r) => r.text()).then((t) => { quadro.srcdoc = t; }).catch(erroDe);
      // Carga manual: a mesma planilha que a automação exporta (Agenda do Astrea, Prazos + Eventos + Audiências).
      ouvir(el, 'click', '[data-importar]', () => {
        const gatilho = quadro.contentDocument?.getElementById('hiddenTrigger');
        if (gatilho) gatilho.click(); else toast('Aguarde o painel carregar e tente de novo.', 'aviso');
      });
      ouvir(el, 'click', '[data-cheia]', async () => {
        try { await el.querySelector('[data-quadro]').requestFullscreen(); } catch { toast('O navegador recusou a tela cheia. Use F11.', 'aviso'); }
      });
      ouvir(el, 'click', '[data-cargas]', () => modal({ titulo: 'Cargas da base', subtitulo: 'Cada execução da automação do Astrea troca a base inteira.', acoes: [{ id: 'ok', rotulo: 'Fechar', tipo: 'primario' }],
        corpo: String(cargas.length ? html`<table class="tbl"><thead><tr><th>Recebida</th><th>Origem</th><th class="num">Prazos</th><th class="num">Eventos</th></tr></thead><tbody>${cargas.map((c) => html`<tr><td>${dataHoraBR(c.recebidoEm)}</td><td>${c.origem === 'automacao' ? 'Automação' : 'Manual'}</td><td class="num">${c.prazos}</td><td class="num">${c.eventos}</td></tr>`)}</tbody></table>` : html`<p class="dica">Nenhuma carga ainda.</p>`),
        aoAbrir(m) { m.addEventListener('acao', () => m.fechar(true)); } }));
      ouvir(el, 'click', '[data-tv]', async () => {
        const acessos = await api.get('/api/bi-prazos/acessos-tv').catch(() => []);
        const ativos = acessos.filter((a) => !a.revogadoEm && new Date(a.expiraEm) > new Date());
        await modal({ titulo: 'Link da TV', subtitulo: 'Abre o painel em tela cheia sem login. Só lê o BI de Prazos. Revogue quando trocar de TV.', largo: true,
          acoes: [{ id: 'fechar', rotulo: 'Fechar' }, { id: 'novo', rotulo: 'Gerar link novo', tipo: 'primario' }],
          corpo: String(html`${ativos.length ? html`<ul class="lista">${ativos.map((a) => html`<li><div><b>${a.nome}</b><small>criado por ${a.criadoPor ?? '—'} · vale até ${dataHoraBR(a.expiraEm)}${a.ultimoUso ? ` · último uso ${relativo(a.ultimoUso)}` : ' · ainda não usado'}</small></div><div class="fim"><button class="btn btn--ghost btn--sm perigo-btn" data-revogar="${a.id}">Revogar</button></div></li>`)}</ul>` : html`<p class="dica">Nenhum link ativo.</p>`}<div data-novo-link></div>`),
          aoAbrir(m) {
            m.addEventListener('click', async (e) => {
              const b = e.target.closest('[data-revogar]'); if (!b) return;
              if (!(await confirmar('Revogar este link?', 'A TV que usa este link para de atualizar.', { rotulo: 'Revogar', perigo: true }))) return;
              try { await api.del(`/api/bi-prazos/acessos-tv/${b.dataset.revogar}`); b.closest('li').remove(); toast('Link revogado'); } catch (er) { erroDe(er); }
            });
            m.addEventListener('acao', async (e) => {
              if (e.detail.id !== 'novo') return m.fechar(true);
              const r = await formulario({ titulo: 'Novo link da TV', rotulo: 'Gerar', campos: [{ nome: 'nome', rotulo: 'Onde vai ficar', valor: 'TV da recepção', obrigatorio: true }],
                async enviar(v) { return api.post('/api/bi-prazos/acessos-tv', { nome: v.nome, dias: 365 }); } });
              if (!r) return;
              const link = `${location.origin}/bi-prazos-tv.html?tv=${encodeURIComponent(r.token)}`;
              m.querySelector('[data-novo-link]').innerHTML = String(html`<div class="card glass mt" style="padding:12px"><b>Abra este endereço no navegador da TV e aperte F11:</b><p class="mono-sm" style="word-break:break-all;margin:8px 0">${link}</p><button class="btn btn--accent btn--sm" data-copiar-link>Copiar link</button><p class="dica">O link aparece só agora. Ele fica gravado no navegador da TV depois da primeira abertura.</p></div>`);
              m.querySelector('[data-copiar-link]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast('Copie o link manualmente', 'aviso'); } });
            });
          } });
      });
      void aoSair;
    },
  };
}
