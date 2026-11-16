/**
 * Relatório mensal do cliente com base no NEXUS (substitui, a partir de 2027, o relatório gerado do PDF bruto do Astrea).
 * Mesmas seções do Gerador: indicadores, natureza, acontecimentos, entregas, próximos passos e linha do tempo.
 * Sai em A4 retrato, papel timbrado NGA, e vira PDF pelo "Salvar como PDF" do navegador.
 */
import { api } from '../api.js';
import { html } from '../util.js';
import { vazio } from '../ui.js';
import { secaoGeradorDoProjeto } from './gerador_lab.js';

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const br = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const reais = (c) => `R$ ${(Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mesPassado = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('sv-SE').slice(0, 7); };
const TIPO = { recuperacao_judicial: 'Recuperação judicial', recuperacao_extrajudicial: 'Recuperação extrajudicial' };

export function htmlDoRelatorio(r, base = location.origin) {
  const c = r.cabecalho; const i = r.indicadores; const rg = i.registros;
  const linha = (l) => `<tr><td class="d">${br(l.data)}</td><td><b>${e(l.tipo ?? l.categoria)}</b> ${e(l.texto)}${l.ref || l.processo ? `<small>${e(l.ref ?? l.processo)}</small>` : ''}${l.detalhe ? `<small>${e(String(l.detalhe).slice(0, 220))}</small>` : ''}</td></tr>`;
  const tabela = (lista, vazioTxt) => (lista.length ? `<table>${lista.map(linha).join('')}</table>` : `<p class="vazio">${e(vazioTxt)}</p>`);
  const card = (n, t) => `<div class="kpi"><b>${e(n)}</b><span>${e(t)}</span></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>[PRÉVIA] Relatório ${e(c.periodo.rotulo)} - ${e(c.cliente)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,700&display=swap">
<style>
@page{size:210mm 297mm;margin:16mm 15mm 18mm}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;font-size:9.5pt;color:#17283B;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.capa{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #BE8E57;padding-bottom:5mm;margin-bottom:6mm}.capa img{height:16mm}
h1{font:700 22pt Newsreader,Georgia,serif;margin:0 0 1mm}h2{font:700 13pt Newsreader,Georgia,serif;margin:7mm 0 3mm;color:#17283B;border-left:3px solid #BE8E57;padding-left:3mm}
.sub{color:#5b6b80;font-size:9pt}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}.kpi{border:1px solid #e3e7ee;border-radius:3mm;padding:3mm}.kpi b{display:block;font:700 15pt Inter;color:#17283B}.kpi span{color:#5b6b80;font-size:8pt}
.reg{display:grid;grid-template-columns:repeat(7,1fr);gap:2mm;margin-top:3mm}.reg div{background:#f6f2ec;border-radius:2mm;padding:2mm;text-align:center}.reg b{display:block;font-size:12pt}.reg span{font-size:7.5pt;color:#5b6b80}
table{width:100%;border-collapse:collapse}td{padding:1.8mm 2mm;border-bottom:1px solid #eef1f5;vertical-align:top}td.d{width:22mm;color:#5b6b80;white-space:nowrap}td small{display:block;color:#7b8798;font-size:8pt;margin-top:.6mm}
.nat{display:flex;flex-wrap:wrap;gap:2mm}.nat span{background:#17283B;color:#fff;border-radius:9mm;padding:1mm 3mm;font-size:8pt}.nat b{color:#BE8E57;margin-left:1mm}
.tl{display:flex;gap:0;margin:2mm 0 0;padding:0;list-style:none}.tl li{flex:1;text-align:center;position:relative;font-size:8pt;padding-top:6mm}.tl li:before{content:'';position:absolute;top:1.5mm;left:50%;width:3.5mm;height:3.5mm;margin-left:-1.75mm;border-radius:50%;background:#d6dbe3}.tl li.ok:before{background:#BE8E57}.tl li:after{content:'';position:absolute;top:3mm;left:calc(50% + 2mm);right:calc(-50% + 2mm);height:.6mm;background:#e3e7ee}.tl li:last-child:after{display:none}
.vazio{color:#7b8798;font-style:italic}.lac{background:#fbf7f0;border:1px solid #ecdcc4;border-radius:3mm;padding:3mm 4mm;margin-top:6mm}.lac li{margin:1mm 0}
.rod{margin-top:8mm;padding-top:3mm;border-top:1px solid #e3e7ee;color:#7b8798;font-size:7.5pt;display:flex;justify-content:space-between}
.previa-tag{display:inline-block;background:#BE8E57;color:#fff;border-radius:2mm;padding:.6mm 2.4mm;font-size:8pt;font-weight:700;letter-spacing:.06em;margin-bottom:1.5mm}
.previa-aviso{background:#fbf7f0;border:1px solid #ecdcc4;border-radius:3mm;padding:2.5mm 4mm;margin-bottom:5mm;color:#8a6d3b;font-size:8.5pt}
</style></head><body>
<div class="capa"><div><span class="previa-tag">PRÉVIA</span><p class="sub">Relatório mensal · ${e(c.periodo.rotulo)}</p><h1>${e(c.cliente)}</h1><p class="sub">${e(c.projeto)} · ${e(TIPO[c.tipo] ?? c.tipo)}${c.cnpj ? ` · CNPJ ${e(c.cnpj)}` : ''}${c.responsavel ? ` · Responsável: ${e(c.responsavel)}` : ''}</p></div><img src="${base}/img/fatura/logo.png" alt="NGA ADV"></div>
<div class="previa-aviso"><b>Prévia do relatório com base no LAB (NEXUS).</b> Este modelo está em preparação para substituir, a partir de 2027, o relatório gerado do PDF do Astrea. Ainda não é o relatório oficial do escritório — confira os dados antes de enviar ao cliente.</div>
<h2>Indicadores do mês</h2><div class="kpis">${card(i.processos, 'processos no projeto')}${card(i.ativos, 'processos ativos')}${card(i.movimentados, 'movimentados no mês')}${card(i.valorCausa ? reais(i.valorCausa) : '—', 'valor das causas')}</div>
<div class="reg"><div><b>${rg.andamentos}</b><span>andamentos</span></div><div><b>${rg.publicacoes}</b><span>publicações</span></div><div><b>${rg.prazosCumpridos}</b><span>prazos cumpridos</span></div><div><b>${rg.tarefasConcluidas}</b><span>tarefas concluídas</span></div><div><b>${rg.reunioes}</b><span>reuniões</span></div><div><b>${rg.atas}</b><span>atas</span></div><div><b>${rg.historicosManuais}</b><span>registros da equipe</span></div></div>
${r.natureza.length ? `<h2>Natureza dos processos</h2><div class="nat">${r.natureza.map((n) => `<span>${e(n.classe)}<b>${n.n}</b></span>`).join('')}</div>` : ''}
<h2>Acontecimentos relevantes</h2>${tabela(r.acontecimentos, 'Nenhum acontecimento relevante registrado no mês.')}${i.rotina ? `<p class="sub">Além disso, ${i.rotina} movimentação(ões) de rotina (juntadas, despachos, remessas).</p>` : ''}
<h2>Entregas da equipe</h2>${tabela(r.entregas, 'Nenhuma entrega registrada no mês.')}
<h2>Próximos passos</h2>${tabela(r.proximos, 'Nenhum prazo, tarefa ou reunião agendada para os próximos 45 dias.')}
${r.marcos.length ? `<h2>Linha do tempo do caso</h2><ul class="tl">${r.marcos.map((m) => `<li class="${m.concluido ? 'ok' : ''}"><b>${e(m.titulo)}</b><br>${br(m.concluido ?? m.prevista)}</li>`).join('')}</ul>` : ''}
${r.lacunas.length ? `<div class="lac"><b>O que este relatório não afirma</b><ul>${r.lacunas.map((l) => `<li>${e(l)}</li>`).join('')}</ul></div>` : ''}
<div class="rod"><span>NGA Advogados · gerado pelo NGA LAB em ${br(r.geradoEm)} por ${e(r.geradoPor)}</span><span>Fonte: processos, andamentos, prazos, tarefas e reuniões registrados no LAB</span></div>
</body></html>`;
}

/** Bloco da aba Relatórios do projeto: agora é o Gerador dentro do LAB (mesmo PDF do Gerador, com agendamento). */
export function secaoRelatorioMensal(ctx) { return secaoGeradorDoProjeto(ctx); }

/** Painel da tela Relatórios: quanto cada cliente já tem de dado no LAB para o relatório sair daqui. */
export async function secaoProntidao() {
  const mes = mesPassado();
  const lista = await api.get(`/api/relatorios/base-nexus?mes=${mes}`).catch(() => []);
  const media = lista.length ? Math.round(lista.reduce((s, x) => s + x.prontidao, 0) / lista.length) : 0;
  const tom = (p) => (p >= 80 ? 'ok' : p >= 50 ? 'aviso' : 'erro');
  return {
    html: html`<section class="card glass up mt"><header class="card__head"><div><h2 class="card__title">Relatórios com base no LAB · preparação para 2027 <span class="selo aviso">prévia</span></h2>
        <p class="card__sub">Em ${mes.split('-').reverse().join('/')}: quanto cada cliente já tem registrado aqui (processos no DataJud, andamentos, prazos e tarefas, reuniões, marcos) para o relatório mensal deixar de depender do PDF do Astrea. Média: <b>${media}%</b>.</p></div></header>
      ${lista.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente / projeto</th><th class="num">Processos</th><th class="num">No DataJud</th><th class="num">Andamentos</th><th class="num">Prazos + tarefas</th><th class="num">Reuniões</th><th class="num">Marcos</th><th>Prontidão</th><th></th></tr></thead><tbody>
        ${lista.map((x) => html`<tr><td><b>${x.projeto}</b>${x.registrosAstrea ? html`<small>${x.registrosAstrea} registro(s) na base Astrea</small>` : ''}</td><td class="num">${x.processos}</td><td class="num">${x.noDatajud}</td><td class="num">${x.andamentos}</td><td class="num">${x.prazos + x.tarefas}</td><td class="num">${x.reunioes}</td><td class="num">${x.marcos}</td>
          <td><div class="rm-barra ${tom(x.prontidao)}"><i style="width:${x.prontidao}%"></i></div><small>${x.prontidao}%</small></td><td><a class="btn btn--ghost btn--sm" href="#/projetos/${x.projetoId}/relatorios">Abrir</a></td></tr>`)}</tbody></table></div>`
        : vazio('chart', 'Nenhum projeto ativo', 'Os projetos aparecem aqui com o quanto já estão prontos.')}</section>`,
  };
}
