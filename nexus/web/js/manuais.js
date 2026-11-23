/**
 * Manuais do portal do cliente e o fluxo de boas-vindas do primeiro acesso.
 *
 * Primeiro acesso: um popup em etapas (manual 1 → manual 2 → … → vídeo → contatos). Cada manual só libera o
 * "Próximo" depois de lido até o fim (rolagem até o último parágrafo); o vídeo, depois de assistido. A leitura
 * fica registrada por pessoa no servidor. Tudo continua disponível na aba "Manuais".
 */
import { api } from './api.js';
import { html, icone, raw } from './util.js';
import { erroDe } from './ui.js';
import { falar, parar as pararFala, falaDisponivel } from './fala.js';

export const MANUAIS = [
  { chave: 'portal', titulo: 'Como funciona o seu portal', icone: 'home', resumo: 'O que você encontra aqui e como acompanhar o seu caso.', secoes: [
    ['Para que serve', ['O portal é o canal oficial entre a sua empresa e a NGA. Tudo o que importa do seu caso fica aqui, organizado e com data: os documentos que precisamos, o andamento dos processos, as reuniões e as faturas.', 'Ele substitui a troca de arquivos por e-mail ou WhatsApp. Assim nada se perde, nada fica em caixa de entrada pessoal e você sabe, a qualquer hora, em que ponto o trabalho está.']],
    ['O que tem em cada área', ['Visão geral: o resumo do caso, a fase em que estamos e o que está pendente com você.', 'Documentos: a lista do que precisamos receber, com o motivo de cada pedido. É por aqui que você envia os arquivos.', 'Andamento: o que aconteceu em cada processo, em linguagem simples.', 'Atas de reunião: pauta, decisões e próximos passos de cada reunião.', 'Faturas: honorários e despesas, com o comprovante de cada pagamento.', 'Manuais: estes guias, sempre disponíveis.']],
    ['Quem vê o quê', ['Todas as pessoas da sua empresa cadastradas no portal veem o mesmo conteúdo. Peça ao escritório para incluir ou retirar alguém. Cada pessoa tem login próprio: não compartilhe a sua senha.']],
  ] },
  { chave: 'documentos', titulo: 'Como enviar os documentos', icone: 'upload', resumo: 'O passo a passo do envio e o que acontece depois.', secoes: [
    ['O checklist', ['Em "Documentos" está a lista do que precisamos. Cada item diz o que é, por que é necessário (o fundamento) e a situação: pendente, enviado, em análise, aprovado ou a complementar.', 'Quando o advogado do caso precisar de algo fora da lista (por exemplo, o comprovante de residência de um sócio), o pedido aparece no topo, com prazo, e você recebe um e-mail.']],
    ['Como enviar', ['1. Abra "Documentos" e toque no item pendente.', '2. Escolha o arquivo no computador ou no celular. Pode enviar mais de um arquivo para o mesmo item.', '3. Pronto: o item passa a "Enviado" e a equipe é avisada. Não é preciso mandar o mesmo arquivo por e-mail.']],
    ['Formatos e qualidade', ['Prefira PDF. Planilhas (balancetes, relação de credores, faturamento) em Excel (.xlsx) ou CSV, sem converter para PDF: assim o sistema lê os números sozinho e o trabalho fica mais rápido.', 'Fotos de documento: tire com boa luz, sem cortes, um documento por arquivo. Documentos com várias páginas: um único PDF.', 'Senha no arquivo atrapalha a leitura. Se o arquivo vier com senha, avise a equipe pelo grupo.']],
    ['Depois do envio', ['A equipe confere cada documento. Se faltar algo, o item volta como "Complementar" com a explicação do que falta. Quando estiver certo, fica "Aprovado". Documento aprovado entra direto no diagnóstico e no quadro de credores do seu caso.']],
  ] },
  { chave: 'sigilo', titulo: 'Sigilo, segurança e LGPD', icone: 'shield', resumo: 'Como protegemos as suas informações e o que esperamos de você.', secoes: [
    ['Sigilo profissional', ['Tudo o que você envia é protegido pelo sigilo profissional da advocacia e só é acessado pela equipe responsável pelo seu caso.']],
    ['Segurança', ['Os arquivos ficam guardados em ambiente protegido, com acesso registrado: sabemos quem abriu cada documento e quando.', 'Nunca pedimos senha por telefone, e-mail ou WhatsApp. Desconfie de qualquer mensagem que peça a sua senha ou pagamento fora do portal e das faturas oficiais.']],
    ['LGPD', ['Os dados pessoais são usados só para a prestação do serviço jurídico contratado, nos termos da Lei 13.709/2018. Você pode pedir informações sobre o tratamento dos seus dados pelos contatos oficiais do escritório.']],
    ['Sua parte', ['Use senha forte e não compartilhe o seu login. Ao usar computador de terceiros, saia do portal ao terminar.']],
  ] },
  { chave: 'comunicacao', titulo: 'Comunicação com o escritório', icone: 'comment', resumo: 'Por onde falar com a NGA e em quanto tempo responder.', secoes: [
    ['Canais oficiais', ['O grupo de WhatsApp do seu caso é o canal do dia a dia: dúvidas rápidas, avisos e agendamentos. Os contatos oficiais do escritório aparecem no final destas boas-vindas e na aba "Manuais".']],
    ['Prazos', ['Muitos pedidos têm prazo ligado a processo ou a negociação. Responder no prazo evita atrasos e custos. Se não conseguir cumprir, avise antes pelo grupo.']],
    ['Reuniões', ['As reuniões ficam registradas em ata no portal, com as decisões e os próximos passos de cada parte.']],
  ] },
];

const ROTULO_CONTATO = { telefone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail', site: 'Site', endereco: 'Endereço', horario: 'Atendimento' };

/** Texto corrido de um manual (título, resumo e seções), para a narração em voz alta. */
export const textoDoManual = (m) => [m.titulo + '.', m.resumo, ...m.secoes.flatMap(([t, ps]) => [t + '.', ...ps])].join(' ');
/**
 * Botão "Ouvir/Parar" que lê um texto em voz alta com a voz do navegador (de graça, sem servidor). Liga num container
 * que já tenha `<button data-ouvir>`. Devolve uma função para parar a narração (ao trocar de etapa ou fechar).
 */
export function ligarOuvir(raiz, obterTexto) {
  const btn = raiz.querySelector('[data-ouvir]'); if (!btn) return () => {};
  let ctrl = null;
  const rotular = (ouvindo) => { btn.setAttribute('aria-pressed', ouvindo ? 'true' : 'false'); btn.innerHTML = String(ouvindo ? html`${icone('stop')} Parar` : html`${icone('play')} Ouvir`); };
  const parar = () => { ctrl?.parar(); ctrl = null; rotular(false); };
  rotular(false);
  btn.addEventListener('click', () => {
    if (ctrl) { parar(); return; }
    ctrl = falar(obterTexto(), { aoFim: () => { ctrl = null; rotular(false); } });
    rotular(true);
  });
  return parar;
}
const linkContato = (c) => c.tipo === 'email' ? `mailto:${c.valor}` : c.tipo === 'telefone' ? `tel:${c.valor.replace(/[^\d+]/g, '')}` : c.tipo === 'whatsapp' ? `https://wa.me/${c.valor.replace(/\D/g, '')}` : c.tipo === 'site' ? c.valor : null;

export function htmlManual(m) {
  return html`<article class="manual"><header class="manual__head"><span class="manual__ico">${icone(m.icone)}</span><div><h3>${m.titulo}</h3><p>${m.resumo}</p></div></header>
    ${m.secoes.map(([t, ps]) => html`<section><h4>${t}</h4>${ps.map((p) => html`<p>${p}</p>`)}</section>`)}<span class="manual__fim" aria-hidden="true"></span></article>`;
}
export function htmlContatos(contatos, extra = []) {
  return html`<ul class="contatos">${[...extra, ...contatos].map((c) => { const l = linkContato(c); return html`<li><span class="contatos__tipo">${ROTULO_CONTATO[c.tipo] ?? c.tipo}</span><b>${c.rotulo}</b>${l ? html`<a href="${l}" target="_blank" rel="noopener noreferrer">${c.valor}</a>` : html`<span>${c.valor}</span>`}</li>`; })}</ul>`;
}
/**
 * O WebM gravado no navegador não traz a duração no cabeçalho: o player mostraria "ao vivo" e sem barra.
 * Truque padrão: pular para o fim para o navegador medir e voltar ao início. `fixando` impede que esse
 * pulo conte como "assistiu até o fim".
 */
export function prepararVideo(v) {
  if (!v || v.__pronto) return; v.__pronto = true; v.__fixando = false;
  v.addEventListener('loadedmetadata', () => {
    if (v.duration !== Infinity) return;
    v.__fixando = true; v.currentTime = 1e101;
    v.addEventListener('timeupdate', function volta() { v.removeEventListener('timeupdate', volta); v.currentTime = 0; setTimeout(() => { v.__fixando = false; }, 300); });
  });
}
export function htmlVideo(url) {
  return html`<div class="bv-video"><video src="${url}" controls playsinline preload="metadata" data-video></video><p class="dica">Vídeo de 1 minuto: como enviar os documentos e o que acontece em seguida.</p></div>`;
}

/** Popup de primeiro acesso. Não fecha até a última etapa. */
export async function boasVindas(projeto, { forcar = false } = {}) {
  let st;
  try { st = await api.get('/api/portal/boas-vindas'); } catch { return; }
  if (!st.pendente && !forcar) return;
  const extra = projeto?.whatsapp_grupo_url ? [{ tipo: 'whatsapp', rotulo: 'Grupo do seu caso', valor: projeto.whatsapp_grupo_url }] : [];
  const etapas = [...MANUAIS.map((m) => ({ tipo: 'manual', m, lido: st.manuais.find((x) => x.chave === m.chave)?.lido })), { tipo: 'video', lido: st.manuais.find((x) => x.chave === 'video')?.lido }, { tipo: 'contatos' }];
  let i = 0;
  const el = document.createElement('div'); el.className = 'bv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Boas-vindas ao portal');
  document.body.append(el); document.body.classList.add('bv-aberto');
  const registrar = (chave) => api.post('/api/portal/boas-vindas/leitura', { chave }).catch(erroDe);
  // Texto corrido de uma etapa, para a narração (manual ou contatos; o vídeo já tem a própria voz).
  const textoDaEtapa = (e) => e.tipo === 'manual' ? textoDoManual(e.m)
    : e.tipo === 'contatos' ? ['Contatos oficiais do escritório. Guarde estes canais.', ...[...extra, ...(st.contatos ?? [])].map((c) => `${ROTULO_CONTATO[c.tipo] ?? c.tipo}: ${c.rotulo}, ${c.valor}.`)].join(' ')
    : '';
  return new Promise((fim) => {
    const pintar = () => {
      pararFala(); // troca de etapa: corta qualquer narração em andamento
      const e = etapas[i]; const ultima = i === etapas.length - 1;
      el.innerHTML = String(html`<div class="bv__caixa">
        <header class="bv__topo"><div class="bv__marca"><img src="/img/nga-adv.png" alt="NGA Advogados" height="30"></div><span class="bv__passo">Etapa ${i + 1} de ${etapas.length}</span></header>
        <div class="bv__trilha">${etapas.map((_, k) => html`<i class="${k < i ? 'ok' : k === i ? 'at' : ''}"></i>`)}</div>
        ${i === 0 ? html`<p class="bv__intro">Bem-vindo ao portal do cliente. Antes de começar, leia estes guias rápidos: eles explicam como o trabalho vai funcionar. Leva poucos minutos e só acontece uma vez.</p>` : ''}
        <div class="bv__conteudo" data-rolagem>${e.tipo === 'manual' ? htmlManual(e.m) : e.tipo === 'video' ? html`<h3 class="bv__h">Veja como enviar os documentos</h3>${htmlVideo(st.videoUrl)}` : html`<h3 class="bv__h">Contatos oficiais do escritório</h3><p class="dica">Guarde estes canais. Eles também ficam na aba "Manuais" do portal.</p>${htmlContatos(st.contatos, extra)}`}</div>
        <footer class="bv__pe"><span class="bv__dica" data-dica>${e.tipo === 'manual' && !e.lido ? 'Role até o fim para continuar' : e.tipo === 'video' && !e.lido ? 'Assista até o fim para continuar' : ''}</span>
          ${falaDisponivel() && e.tipo !== 'video' ? html`<button type="button" class="btn btn--ghost bv__ouvir" data-ouvir aria-pressed="false" title="Ouvir este guia em voz alta">${icone('play')} Ouvir</button>` : ''}
          ${i > 0 ? html`<button type="button" class="btn btn--ghost" data-voltar>Voltar</button>` : ''}
          <button type="button" class="btn btn--accent" data-proximo ${(e.tipo === 'manual' || e.tipo === 'video') && !e.lido ? raw('disabled') : ''}>${ultima ? 'Entrar no portal' : 'Próximo'}</button></footer></div>`);
      const prox = el.querySelector('[data-proximo]'); const rol = el.querySelector('[data-rolagem]'); rol.scrollTop = 0;
      const liberar = () => { if (e.lido) return; e.lido = true; prox.disabled = false; el.querySelector('[data-dica]').textContent = ''; registrar(e.tipo === 'video' ? 'video' : e.m.chave); };
      if (e.tipo === 'manual' && !e.lido) {
        const fimEl = el.querySelector('.manual__fim');
        const obs = new IntersectionObserver((xs) => { if (xs.some((x) => x.isIntersecting)) { obs.disconnect(); liberar(); } }, { root: rol, threshold: 1 });
        obs.observe(fimEl);
      }
      if (e.tipo === 'video') {
        const v = el.querySelector('[data-video]'); prepararVideo(v);
        v?.addEventListener('ended', () => { if (!v.__fixando) liberar(); });
        // Vídeo indisponível (rede, formato): não prende o cliente.
        v?.addEventListener('error', () => { el.querySelector('[data-dica]').textContent = 'Vídeo indisponível agora; você pode vê-lo depois na aba Manuais.'; liberar(); });
      }
      const introTxt = i === 0 ? 'Bem-vindo ao portal do cliente da NGA. ' : '';
      ligarOuvir(el, () => introTxt + textoDaEtapa(e));
      prox.addEventListener('click', () => { if (ultima) { pararFala(); el.remove(); document.body.classList.remove('bv-aberto'); fim(true); } else { i++; pintar(); } });
      el.querySelector('[data-voltar]')?.addEventListener('click', () => { i--; pintar(); });
      prox.focus();
    };
    pintar();
  });
}

/** Aba "Manuais" do portal. */
export async function abaManuais(projeto) {
  const st = await api.get('/api/portal/boas-vindas').catch(() => ({ contatos: [], videoUrl: '/video/boas-vindas.webm?v=2311', manuais: [] }));
  const extra = projeto?.whatsapp_grupo_url ? [{ tipo: 'whatsapp', rotulo: 'Grupo do seu caso', valor: projeto.whatsapp_grupo_url }] : [];
  return {
    html: html`<div class="manuais-grade">${MANUAIS.map((m) => html`<button type="button" class="manual-card card glass up" data-manual="${m.chave}"><span class="manual__ico">${icone(m.icone)}</span><b>${m.titulo}</b><small>${m.resumo}</small><em>Ler ${icone('chevron')}</em></button>`)}</div>
      <div class="grid2 mt"><section class="card glass up"><header class="card__head"><div><h2 class="card__title">Vídeo: como enviar os documentos</h2><p class="card__sub">1 minuto</p></div></header>${htmlVideo(st.videoUrl)}</section>
        <section class="card glass up"><header class="card__head"><div><h2 class="card__title">Contatos oficiais</h2><p class="card__sub">Os canais da NGA para o seu caso</p></div></header>${htmlContatos(st.contatos, extra)}</section></div>
      <div data-leitor class="mt"></div>`,
    depois(el) {
      el.querySelectorAll('[data-video]').forEach(prepararVideo);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-manual]'); if (!b) return;
        pararFala(); // abriu outro guia: corta a narração anterior
        const m = MANUAIS.find((x) => x.chave === b.dataset.manual); const alvo = el.querySelector('[data-leitor]');
        alvo.innerHTML = String(html`<section class="card glass up manual-leitor">${falaDisponivel() ? html`<div class="manual-leitor__barra"><button type="button" class="btn btn--ghost" data-ouvir aria-pressed="false" title="Ouvir este guia em voz alta">${icone('play')} Ouvir</button></div>` : ''}${htmlManual(m)}</section>`);
        ligarOuvir(alvo, () => textoDoManual(m));
        alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
  };
}
