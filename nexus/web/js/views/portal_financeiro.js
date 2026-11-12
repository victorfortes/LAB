/**
 * Saúde financeira do cliente a partir do fechamento mensal.
 * O cliente informa poucos números por mês (ou importa a planilha modelo); a
 * NGA lê os indicadores e os alertas, e confere o mês.
 */
import { api } from '../api.js';
import { estado, pode } from '../estado.js';
import { html, icone, ouvir, paraCentavos, raw, reais } from '../util.js';
import { confirmar, erroDe, formulario, toast, vazio } from '../ui.js';
import { moeda } from '../graficos.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (c) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const SITUACAO = { estavel: ['ok', 'Estável'], atencao: ['aviso', 'Pede atenção'], critica: ['erro', 'Crítica'], sem_dados: ['', 'Sem dados ainda'] };
const num = (v, suf = '') => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR')}${suf}`);
const mesPassado = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Barras de faturamento (receita líquida) e marca do resultado, últimos 12 meses. Sem biblioteca: SVG simples. */
function grafico(serie) {
  const s = serie.slice(-12).filter((x) => x.receitaCentavos !== null);
  if (s.length < 2) return '';
  const vals = s.flatMap((x) => [Number(x.receitaCentavos), Math.abs(Number(x.resultadoCentavos ?? 0))]);
  const max = Math.max(1, ...vals); const L = 640, A = 150, w = L / s.length;
  const y = (v) => A - (Math.abs(v) / max) * (A - 12);
  return html`<svg class="saude-grafico" viewBox="0 0 ${L} ${A + 22}" role="img" aria-label="Receita líquida e resultado por mês">
    ${s.map((x, i) => { const r = Number(x.receitaCentavos); const res = x.resultadoCentavos === null ? null : Number(x.resultadoCentavos);
      return raw(`<g><title>${rotuloMes(x.competencia)}: receita ${moeda(r)}${res === null ? '' : `, resultado ${moeda(res)}`}</title>
        <rect x="${i * w + w * 0.2}" y="${y(r)}" width="${w * 0.6}" height="${A - y(r)}" rx="3" fill="#6C8FC0" opacity=".55"/>
        ${res === null ? '' : `<rect x="${i * w + w * 0.32}" y="${y(res)}" width="${w * 0.36}" height="3" rx="1.5" fill="${res < 0 ? '#F87171' : '#4ADE80'}"/>`}
        <text x="${i * w + w / 2}" y="${A + 16}" text-anchor="middle" font-size="10" fill="#8E99AB">${rotuloMes(x.competencia)}</text></g>`); })}
  </svg><p class="saude-legenda"><span><i style="background:#6C8FC0"></i>Receita líquida</span><span><i style="background:#4ADE80"></i>Resultado positivo</span><span><i style="background:#F87171"></i>Resultado negativo</span></p>`;
}

export async function painelSaude(projetoId, recarregar) {
  const d = await api.get(`/api/projetos/${projetoId}/fechamentos`);
  const informa = pode('financeiro_cliente.escrever');
  const ehCliente = !estado.eu?.organizacoes?.some((o) => o.tipo === 'escritorio');
  const confere = !ehCliente && pode('projeto.escrever');
  const u = d.serie.at(-1); const [tom, rotulo] = SITUACAO[d.situacao];
  const porMes = new Map(d.meses.map((m) => [m.competencia, m]));
  const kpi = (r, v, alerta) => html`<div class="saude-kpi ${alerta ? 'is-alert' : ''}"><small>${r}</small><b>${v}</b></div>`;

  const formularioMes = (competencia) => {
    const atual = porMes.get(competencia);
    return formulario({ titulo: 'Fechamento do mês', subtitulo: 'Preencha o que tiver. Campo em branco fica como "não informado", nunca como zero. Valores em reais.', rotulo: 'Salvar mês', largo: true,
      campos: [
        { nome: 'competencia', rotulo: 'Mês', tipo: 'month', obrigatorio: true, valor: competencia, metade: true },
        { nome: 'empregados', rotulo: 'Número de empregados', tipo: 'number', metade: true, valor: atual?.empregados ?? '' },
        ...d.campos.map((c, i) => ({ nome: c.chave, rotulo: c.rotulo, dica: c.dica, metade: true, placeholder: '0,00', valor: atual?.valores[c.chave] ? reais(atual.valores[c.chave]) : '' })),
        { nome: 'observacao', rotulo: 'Algo que a NGA precisa saber sobre este mês?', tipo: 'textarea', valor: atual?.observacao ?? '' },
      ],
      async enviar(v) {
        const corpo = { competencia: v.competencia, empregados: v.empregados === undefined || v.empregados === '' ? null : Number(v.empregados), observacao: v.observacao || null };
        for (const c of d.campos) {
          const t = String(v[c.chave] ?? '').trim();
          if (!t) { corpo[c.chave] = null; continue; }
          const neg = t.startsWith('-'); const cent = paraCentavos(t.replace(/^-/, ''));
          if (!cent) throw new Error(`${c.rotulo}: valor inválido. Use 150.000,00`);
          corpo[c.chave] = neg ? `-${cent}` : cent;
        }
        await api.put(`/api/projetos/${projetoId}/fechamentos`, corpo);
      } }).then((ok) => { if (ok) { toast('Mês salvo'); recarregar(); } });
  };

  const modelo = () => {
    const cab = ['Mes (AAAA-MM)', ...d.campos.map((c) => c.rotulo), 'Empregados'];
    const linhas = d.meses.length ? d.meses.map((m) => [m.competencia, ...d.campos.map((c) => (m.valores[c.chave] ? reais(m.valores[c.chave]) : '')), m.empregados ?? '']) : [[mesPassado(), ...d.campos.map(() => ''), '']];
    const csv = [cab, ...linhas].map((l) => l.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'fechamento-mensal-modelo.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const importar = async (arquivo) => {
    const texto = await arquivo.text();
    const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => (l.match(/("([^"]|"")*"|[^;]*)(;|$)/g) ?? []).map((c) => c.replace(/;$/, '').replace(/^"|"$/g, '').replaceAll('""', '"').trim()));
    const corpos = []; const erros = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const competencia = /^(\d{4})-(\d{2})$/.test(l[0] ?? '') ? l[0] : /^(\d{2})\/(\d{4})$/.test(l[0] ?? '') ? `${l[0].slice(3)}-${l[0].slice(0, 2)}` : null;
      if (!competencia) { if (l.some(Boolean)) erros.push(`linha ${i + 2}: mês inválido`); continue; }
      const corpo = { competencia, empregados: l[d.campos.length + 1] ? Number(l[d.campos.length + 1]) || null : null };
      d.campos.forEach((c, k) => { const t = (l[k + 1] ?? '').replace(/^-/, ''); const cent = t ? paraCentavos(t) : null; if (t && !cent) erros.push(`linha ${i + 2}: ${c.rotulo} inválido`); corpo[c.chave] = cent ? ((l[k + 1] ?? '').startsWith('-') ? `-${cent}` : cent) : null; });
      corpos.push(corpo);
    }
    if (!corpos.length) return toast(erros[0] ?? 'Nenhum mês encontrado na planilha. Use o modelo.', 'erro');
    if (!(await confirmar(`Importar ${corpos.length} mês(es)?`, `${corpos.map((c) => rotuloMes(c.competencia)).join(', ')}. Meses já informados serão substituídos.${erros.length ? ` Atenção: ${erros.slice(0, 3).join('; ')}.` : ''}`, { rotulo: 'Importar' }))) return;
    let ok = 0; for (const c of corpos) { try { await api.put(`/api/projetos/${projetoId}/fechamentos`, c); ok++; } catch (e) { erroDe(e); } }
    toast(`${ok} mês(es) importado(s)`); recarregar();
  };

  const recentes = [...d.meses].reverse().slice(0, 12);
  const serieDe = new Map(d.serie.map((x) => [x.competencia, x]));
  return {
    html: html`<section class="card glass up saude">
      <header class="card__head"><div><span class="nx-eyebrow">Saúde financeira</span><h2 class="card__title">${u ? `Fechamento de ${rotuloMes(u.competencia)}` : 'Fechamento do mês'}</h2>
        <p class="card__sub">${ehCliente ? 'Informe todo mês os números da empresa. Leva poucos minutos e é o que permite à NGA acompanhar a saúde do seu negócio.' : 'Números informados pelo cliente no portal, mês a mês.'}</p></div>
        <span class="selo ${tom}">${rotulo}</span></header>
      ${u ? html`<div class="saude-kpis">${kpi('Receita líquida', u.receitaLiquida ? `R$ ${u.receitaLiquida}` : '—')}${kpi('Resultado do mês', u.resultado ? `R$ ${u.resultado}` : '—', u.resultadoCentavos?.startsWith('-'))}
          ${kpi('Margem líquida', num(u.margemLiquida, '%'), u.margemLiquida !== null && u.margemLiquida < 0)}${kpi('Caixa cobre', u.mesesDeCaixa === null ? '—' : `${num(u.mesesDeCaixa)} mês`, u.mesesDeCaixa !== null && u.mesesDeCaixa < 1)}
          ${kpi('Liquidez', num(u.liquidezCorrente), u.liquidezCorrente !== null && u.liquidezCorrente < 1)}${kpi('Juros sobre faturamento', num(u.pesoFinanceiro, '%'), u.pesoFinanceiro !== null && u.pesoFinanceiro >= 8)}</div>
        ${d.faltando.length ? html`<p class="dica">Faltou informar em ${rotuloMes(u.competencia)}: ${d.faltando.join(', ')}.</p>` : ''}`
        : vazio('chart', 'Nenhum mês informado ainda', ehCliente ? 'Comece pelo mês passado. Você pode digitar aqui ou preencher a planilha modelo e importar.' : 'O cliente ainda não informou nenhum fechamento mensal pelo portal.')}
      ${informa ? html`<div class="flex mt"><button type="button" class="btn btn--accent" data-mes="${mesPassado()}">${icone('plus')}Informar mês</button>
        <button type="button" class="btn btn--ghost" data-modelo>${icone('download')}Planilha modelo</button>
        <label class="btn btn--ghost" style="cursor:pointer">${icone('upload')}Importar planilha<input type="file" hidden accept=".csv,.txt" data-importar></label></div>` : ''}
      ${grafico(d.serie)}
      ${d.alertas.length ? html`<h3 class="mini-h mt">Alertas</h3><ul class="saude-alertas">${d.alertas.slice(0, 8).map((a) => html`<li class="${a.nivel}"><i></i><b>${rotuloMes(a.competencia)}</b><span>${a.texto}</span></li>`)}</ul>` : ''}
      ${recentes.length ? html`<h3 class="mini-h mt">Meses informados</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th><th class="num">Faturamento</th><th class="num">Resultado</th><th class="num">Margem</th><th class="num">Caixa (meses)</th><th>Conferência</th><th></th></tr></thead>
        <tbody>${recentes.map((m) => { const x = serieDe.get(m.competencia) ?? {}; return html`<tr><td><b>${rotuloMes(m.competencia)}</b>${m.observacao ? html`<small title="${m.observacao}">com observação</small>` : ''}</td>
          <td class="num">${m.valores.faturamento ? reais(m.valores.faturamento) : '—'}</td><td class="num ${x.resultadoCentavos?.startsWith('-') ? 'neg' : ''}">${x.resultado ?? '—'}</td>
          <td class="num">${num(x.margemLiquida, '%')}</td><td class="num">${num(x.mesesDeCaixa)}</td>
          <td>${m.conferidoEm ? html`<span class="selo ok">Conferido</span>` : html`<span class="selo">A conferir</span>`}</td>
          <td class="num">${informa && !(ehCliente && m.conferidoEm) ? html`<button type="button" class="btn btn--ghost btn--sm" data-mes="${m.competencia}">Editar</button>` : ''}${confere && !m.conferidoEm ? html`<button type="button" class="btn btn--ghost btn--sm" data-conferir="${m.competencia}">Conferir</button>` : ''}</td></tr>`; })}</tbody></table></div>` : ''}
    </section>`,
    depois(el) {
      ouvir(el, 'click', '[data-mes]', (b) => formularioMes(b.dataset.mes));
      ouvir(el, 'click', '[data-modelo]', () => modelo());
      el.querySelector('[data-importar]')?.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importar(f).catch(erroDe); });
      ouvir(el, 'click', '[data-conferir]', async (b) => { try { await api.post(`/api/projetos/${projetoId}/fechamentos/${b.dataset.conferir}/conferir`); toast('Mês conferido. O cliente não altera mais este mês pelo portal.'); recarregar(); } catch (e) { erroDe(e); } });
    },
  };
}
