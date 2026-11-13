(function(){
"use strict";

// ================= state =================
let ROWS = [];
let UPDATED_AT = null;
let DB = null;
const charts = {};
const filters = {
  resp:new Set(), area:new Set(), prov:new Set(), status:'todos', search:'',
  bucket:null,        // 'hoje' | 'd3' | 'd7' | 'atrasado'  (geral tab quick filter)
  dateFatal:null,     // epoch ms of a specific fatal date (geral/prox7 line clicks)
  dateConcl:null,     // epoch ms of a specific conclusion date (perf bar clicks)
  statusPrazo:null,   // 'Cumprido com atraso' (perf KPI click)
  mes:''              // 'AAAA-MM' do mês selecionado no filtro global, '' = todos os meses
};
let activeTab = 'geral';
const sortState = {};
const TAB_ORDER = ['geral','hoje','prox7','perf','eventos'];
const SUBTITLES = {geral:'Visão Geral', hoje:'Prazos hoje', prox7:'Próximos 7 dias', perf:'Performance - mês', eventos:'Eventos'};
let rotateTimer = null, rotateSeconds = 20, rotateLen = 20;

const COLS = {
  data:'Data', d1:'Data + 1 dia útil', tipo:'Tipo', resp:'Responsável', titulo:'Título',
  caso:'Título do processo/caso/atendimento', numero:'Número do processo',
  juizo:'Juízo', status:'Status', conclusao:'Data de conclusão', hora:'Hora'
};

// ================= helpers =================
function parseBR(s){
  if(!s) return null;
  const m = String(s).split(' ')[0].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
}
function fmt(d){ if(!d) return '-'; return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
function fmtShort(d){ return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); }
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function monthLabel(key){ const [y,m] = key.split('-'); return MONTH_NAMES[+m-1]+' de '+y; }
function sod(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function diffDays(a,b){ return Math.round((sod(a)-sod(b))/86400000); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function areaFromResp(resp){
  return AREA_MAP[resp] || 'Não classificado';
}
const AREA_MAP = {
  'Maurício':'Civil','Maurício Graboski':'Civil','Caroline':'Civil','Caroline Chemim':'Civil',
  'Pedro':'Civil','Pedro de Melo Ferraz':'Civil','Karina':'Civil','Marcos':'Civil',
  'Karina Magatão':'Civil','Maria Eduarda':'Civil',
  'Rodrigo':'Empresarial','Rodrigo Giaretton':'Empresarial','Victor':'Empresarial','Victor Fortes':'Empresarial',
  'Bruna':'Empresarial','Bruna Richter':'Empresarial','Agustinho':'Empresarial','Eduardo Agustinho':'Empresarial',
  'João Victor':'Empresarial','João Paulo':'Empresarial','Anne Marie':'Empresarial','Anne':'Empresarial',
  'Mauro':'AJ','Mauro Alexandre':'AJ',
  'Gustavo Brasil':'Administrativo',
  'Camilla Rodrigues':'Controladoria'
};
const AREA_COLORS = {'Civil':'#6FA8DC','Empresarial':'#D6A04A','Administrativo':'#A5A5A5','Controladoria':'#70AD47','AJ':'#BFBFBF','Não classificado':'#BFBFBF'};
const PROV_COLORS = {
  'MANIFESTAR':'#4472C4','MANIFESTAR - OUTRAS DECISÕES':'#5B9BD5','RECURSO / MANIFESTAR':'#ED7D31',
  'EMBARGOS DE DECLARAÇÃO':'#FFC000','CONTRARRAZÕES':'#70AD47','PRAZO AO AJ':'#A5A5A5','CIÊNCIA DA DISTRIBUIÇÃO':'#8064A2'
};
const PROV_DEFAULT = '#7F8C8D';
const RESP_COLORS = {
  'Maurício':'#5B9BD5','Maurício Graboski':'#5B9BD5','Bruna':'#75C9C8','Bruna Richter':'#75C9C8',
  'Rodrigo':'#2F75B5','Rodrigo Giaretton':'#2F75B5','Caroline':'#46B8A9','Caroline Chemim':'#46B8A9',
  'Victor':'#38A58A','Victor Fortes':'#38A58A','Pedro':'#A9D6E5','Pedro de Melo Ferraz':'#A9D6E5'
};
const RESP_DEFAULT = '#BFBFBF';

// NOTE: "Data" já é a data fatal do prazo (validado: bate com a contagem do Astrea).
// Se a exportação um dia vier com "Data + 1 dia útil" preenchida, ela tem prioridade;
// caso contrário usamos a própria Data, sem somar dias úteis por cima.
// Responsáveis cujos prazos ficam de fora do painel por completo.
const EXCLUDED_RESP = new Set(['Celina Galeb Nitschke']);

// Blindagem contra duplicata exata: se a mesma linha (idêntica em todos os
// campos) aparecer mais de uma vez na base — o que pode acontecer se a
// sincronização gravar a mesma tarefa duas vezes — só a primeira ocorrência
// é usada. Isso nunca remove tarefas diferentes, só cópias 100% idênticas.
function dedupeExact(rows){
  const seen = new Set();
  return rows.filter(r=>{
    const key = JSON.stringify(r);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Eventos (tipos "Evento" e "Audiência" no Astrea) ficam fora de todas as contas de prazos e têm aba própria.
function isEvento(r){
  const t = String(r.tipo||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  return t.startsWith('event') || t.startsWith('audien');
}
function enrichEventos(rawRows){
  const rows = dedupeExact(rawRows);
  const today = sod(new Date());
  return rows.filter(r=> isEvento(r) && !EXCLUDED_RESP.has(r.resp)).map(r=>{
    const dataDate = parseBR(r.data);
    const conclusaoDate = parseBR(r.conclusao);
    const dd = dataDate ? diffDays(dataDate, today) : null;
    const hm = String(r.hora||'').match(/(\d{1,2}):(\d{2})/);
    const mins = hm ? (+hm[1])*60 + (+hm[2]) : 0;
    return {
      data:r.data, hora:r.hora||'', tipo:r.tipo, resp:r.resp||'Sem responsável', titulo:r.titulo||'Sem título',
      caso:r.caso, numero:r.numero, juizo:r.juizo, status:r.status, conclusao:r.conclusao,
      dataDate, fatal:dataDate, conclusaoDate, area:areaFromResp(r.resp),
      emAndamento:(r.status!=='Concluído'), statusPrazo:null, dd, bucket:null,
      ordem: dd===null ? 1e9 : (dd>=0 ? dd : 1000-dd)*2000 + mins
    };
  });
}

function enrich(rawRows){
  const rows = dedupeExact(rawRows);
  const today = sod(new Date());
  return rows.filter(r=> !isEvento(r) && !EXCLUDED_RESP.has(r.resp)).map(r=>{
    const dataDate = parseBR(r.data);
    const d1Date = parseBR(r.d1);
    const fatal = d1Date || dataDate;
    const conclusaoDate = parseBR(r.conclusao);
    const area = areaFromResp(r.resp);
    const emAndamento = (r.status !== 'Concluído');
    const dd = fatal ? diffDays(fatal, today) : null;

    // Status Prazo: replica exatamente a regra DAX, baseada na presença de
    // "Data de conclusão" (não no campo Status em si).
    let statusPrazo;
    if(!conclusaoDate){
      statusPrazo = (dd!==null && dd<0) ? 'Atrasado' : 'No prazo';
    } else {
      statusPrazo = (fatal && sod(conclusaoDate) > sod(fatal)) ? 'Cumprido com atraso' : 'Cumprido no prazo';
    }

    // D. Fatal: replica a SWITCH original (baseada só na Data, sem filtrar por Status).
    let bucket = null;
    if(dd!==null){
      if(dd<0) bucket='ATRASADO';
      else if(dd===0) bucket='HOJE';
      else if(dd===1) bucket='AMANHÃ';
      else if(dd<=7) bucket='PRÓXIMOS 7 DIAS';
      else bucket='FUTURO';
    }
    return {
      data:r.data, tipo:r.tipo, resp:r.resp||'Sem responsável', titulo:r.titulo||'Sem providência',
      caso:r.caso, numero:r.numero, juizo:r.juizo, status:r.status, conclusao:r.conclusao,
      dataDate, fatal, conclusaoDate, area, emAndamento, statusPrazo, dd, bucket
    };
  });
}

function applyFilters(rows){
  const q = filters.search.toLowerCase();
  return rows.filter(r=>{
    if(filters.resp.size && !filters.resp.has(r.resp)) return false;
    if(filters.area.size && !filters.area.has(r.area)) return false;
    if(filters.prov.size && !filters.prov.has(r.titulo)) return false;
    if(filters.status==='andamento' && !r.emAndamento) return false;
    if(filters.status==='concluido' && r.emAndamento) return false;
    if(filters.statusPrazo && r.statusPrazo!==filters.statusPrazo) return false;
    if(filters.mes && (!r.dataDate || monthKey(r.dataDate)!==filters.mes)) return false;
    if(filters.bucket && r.emAndamento){
      if(filters.bucket==='hoje' && r.dd!==0) return false;
      if(filters.bucket==='d3' && !(r.dd!==null && r.dd>0 && r.dd<=3)) return false;
      if(filters.bucket==='d7' && !(r.dd!==null && r.dd>0 && r.dd<=7)) return false;
      if(filters.bucket==='atrasado' && !(r.dd!==null && r.dd<0)) return false;
    } else if(filters.bucket && !r.emAndamento){ return false; }
    if(filters.dateFatal!==null){
      if(!r.fatal || sod(r.fatal).getTime()!==filters.dateFatal) return false;
    }
    if(filters.dateConcl!==null){
      if(!r.conclusaoDate || sod(r.conclusaoDate).getTime()!==filters.dateConcl) return false;
    }
    if(q && !(r.caso||'').toLowerCase().includes(q) && !(r.numero||'').toLowerCase().includes(q)) return false;
    return true;
  });
}

function countBy(rows, key){
  const m = new Map();
  rows.forEach(r=>{ const k = r[key]; m.set(k,(m.get(k)||0)+1); });
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

// ================= chip bar (active-filter feedback) =================
function renderChips(){
  const bar = document.getElementById('chipBar');
  const chips = [];
  filters.resp.forEach(v=>chips.push({label:'Responsável: '+v, clear:()=>filters.resp.delete(v)}));
  filters.area.forEach(v=>chips.push({label:'Área: '+v, clear:()=>filters.area.delete(v)}));
  filters.prov.forEach(v=>chips.push({label:'Providência: '+v, clear:()=>filters.prov.delete(v)}));
  if(filters.status!=='todos') chips.push({label:'Status: '+(filters.status==='andamento'?'Em andamento':'Concluído'), clear:()=>{filters.status='todos'; document.getElementById('fStatus').value='todos';}});
  if(filters.bucket){
    const names = {hoje:'Fatal hoje', d3:'Fatal em 3 dias', d7:'Fatal em 7 dias', atrasado:'Atrasados'};
    chips.push({label:names[filters.bucket], clear:()=>{filters.bucket=null;}});
  }
  if(filters.dateFatal!==null) chips.push({label:'Data fatal: '+fmt(new Date(filters.dateFatal)), clear:()=>{filters.dateFatal=null;}});
  if(filters.dateConcl!==null) chips.push({label:'Concluído em: '+fmt(new Date(filters.dateConcl)), clear:()=>{filters.dateConcl=null;}});
  if(filters.statusPrazo) chips.push({label:filters.statusPrazo, clear:()=>{filters.statusPrazo=null;}});
  if(filters.mes) chips.push({label:'Mês: '+monthLabel(filters.mes), clear:()=>{filters.mes=''; document.getElementById('fMes').value='';}});
  if(filters.search) chips.push({label:'Busca: '+filters.search, clear:()=>{filters.search=''; document.getElementById('fSearch').value='';}});

  bar.innerHTML = chips.map((c,i)=>`<span class="chip">${esc(c.label)}<button data-i="${i}">×</button></span>`).join('');
  bar.querySelectorAll('button').forEach((btn,i)=>{
    btn.addEventListener('click', ()=>{ chips[i].clear(); syncFilterUI(); render(); });
  });
}
function syncFilterUI(){
  document.getElementById('msRespSummary').innerHTML = (filters.resp.size?`${filters.resp.size} selecionado${filters.resp.size>1?'s':''}`:'Todos')+'<span class="caret">▼</span>';
  document.getElementById('msAreaSummary').innerHTML = (filters.area.size?`${filters.area.size} selecionado${filters.area.size>1?'s':''}`:'Todas')+'<span class="caret">▼</span>';
  document.getElementById('msProvSummary').innerHTML = (filters.prov.size?`${filters.prov.size} selecionado${filters.prov.size>1?'s':''}`:'Todas')+'<span class="caret">▼</span>';
  document.querySelectorAll('#msRespPanel input').forEach(cb=>cb.checked=filters.resp.has(cb.value));
  document.querySelectorAll('#msAreaPanel input').forEach(cb=>cb.checked=filters.area.has(cb.value));
  document.querySelectorAll('#msProvPanel input').forEach(cb=>cb.checked=filters.prov.has(cb.value));
}

// toggle helpers used by click-to-filter interactions
function toggleSet(setObj, value){ setObj.has(value) ? setObj.delete(value) : setObj.add(value); syncFilterUI(); render(); }
function toggleBucket(v){ filters.bucket = (filters.bucket===v) ? null : v; render(); }
function toggleDateFatal(ts){ filters.dateFatal = (filters.dateFatal===ts) ? null : ts; render(); }
function toggleDateConcl(ts){ filters.dateConcl = (filters.dateConcl===ts) ? null : ts; render(); }
function toggleStatusPrazo(v){ filters.statusPrazo = (filters.statusPrazo===v) ? null : v; render(); }
function toggleStatus(v){ filters.status = (filters.status===v) ? 'todos' : v; document.getElementById('fStatus').value = filters.status; render(); }
window.__biToggleResp = (v)=> toggleSet(filters.resp, v); // exposed for inline row handlers via closures below (not used directly)

// ================= charts =================
const AXIS = {
  x:{ticks:{color:'#9db0c8',font:{size:11}},grid:{color:'#25405f'},border:{color:'#25405f'}},
  y:{ticks:{color:'#9db0c8',font:{size:11},autoSkip:false},grid:{color:'#25405f'},border:{color:'#25405f'}}
};
const BAR_PALETTE = ['#3f7fc1','#35c4b5','#6aaae4','#c8954a','#8ba0b8','#e3b04b','#5b8fd6','#4fbfa8'];
const valueLabel = {
  id:'valueLabel',
  afterDatasetsDraw(chart){
    const opt = chart.options.plugins && chart.options.plugins.valueLabel;
    if(opt === false) return;
    // NOTA: nunca guardar funções dentro de options.plugins.* — o Chart.js resolve
    // opções "scriptable" chamando qualquer função sozinho, o que quebrava isso aqui.
    // Por isso o formato é escolhido por uma string simples ('percent' ou padrão).
    const isPercent = !!(opt && opt.format === 'percent');
    const minValue = (opt && typeof opt.minValue === 'number') ? opt.minValue : 0;
    const {ctx} = chart;
    ctx.save();
    ctx.font='600 11px Segoe UI, sans-serif';
    ctx.fillStyle='#e8eef6';
    chart.data.datasets.forEach((ds, di)=>{
      const meta = chart.getDatasetMeta(di);
      if(meta.hidden) return;
      meta.data.forEach((el,i)=>{
        const v = ds.data[i];
        if(v==null || v===0 || Math.abs(v)<minValue) return;
        if(el.x==null || el.y==null) return;
        const text = isPercent ? (Math.round(v)+'%') : String(v);
        const horiz = chart.options.indexAxis==='y';
        ctx.textAlign = horiz?'left':'center';
        ctx.textBaseline = horiz?'middle':'bottom';
        ctx.fillText(text, horiz?el.x+6:el.x, horiz?el.y:el.y-4);
      });
    });
    ctx.restore();
  }
};
Chart.register(valueLabel);

const centerText = {
  id:'centerText',
  afterDraw(chart){
    const opt = chart.options.plugins && chart.options.plugins.centerText;
    if(!opt || opt.main == null || opt.main === '') return;
    const {ctx, chartArea} = chart;
    if(!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f5f9';
    ctx.font = '700 26px Segoe UI, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opt.main, cx, cy+2);
    if(opt.sub){
      ctx.font = '600 10px Segoe UI, sans-serif';
      ctx.fillStyle = '#9db0c8';
      ctx.textBaseline = 'top';
      ctx.fillText(opt.sub, cx, cy+4);
    }
    ctx.restore();
  }
};
Chart.register(centerText);

function draw(id, cfg){
  const el = document.getElementById(id);
  if(!el) return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(el.getContext('2d'), cfg);
}
function colorsFor(entries, activeSet, colorMap, defaultColor){
  if(activeSet && activeSet.size){
    return entries.map(e=> activeSet.has(e[0]) ? '#ffffff' : '#31456299');
  }
  if(colorMap){
    return entries.map(e=> colorMap[e[0]] || defaultColor || '#7F8C8D');
  }
  return entries.map((_,i)=>BAR_PALETTE[i%BAR_PALETTE.length]);
}
function hBar(id, entries, activeSet, onPick, colorMap, defaultColor){
  draw(id, {
    type:'bar',
    data:{labels:entries.map(e=>e[0]), datasets:[{data:entries.map(e=>e[1]), backgroundColor:colorsFor(entries,activeSet,colorMap,defaultColor), borderRadius:2, barPercentage:.8}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:false,
      layout:{padding:{right:24}},
      onClick:(evt, els)=>{ if(els.length && onPick) onPick(entries[els[0].index][0]); },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{display:false}, tooltip:{enabled:true}},
      scales:{x:Object.assign({},AXIS.x,{beginAtZero:true}), y:Object.assign({},AXIS.y,{grid:{display:false}})}}
  });
}
function vBar(id, entries, activeSet, onPick, colorMap, defaultColor){
  draw(id, {
    type:'bar',
    data:{labels:entries.map(e=>e[0]), datasets:[{data:entries.map(e=>e[1]), backgroundColor:colorsFor(entries,activeSet,colorMap,defaultColor), borderRadius:2, barPercentage:.6}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      layout:{padding:{top:18}},
      onClick:(evt, els)=>{ if(els.length && onPick) onPick(entries[els[0].index][0]); },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{display:false}},
      scales:{x:Object.assign({},AXIS.x,{grid:{display:false}}), y:Object.assign({},AXIS.y,{beginAtZero:true})}}
  });
}
function areaLine(id, labels, values, tsList, activeTs, onPick){
  const pointColors = tsList.map(ts=> (activeTs!==null && ts===activeTs) ? '#ffffff' : '#6aaae4');
  draw(id, {
    type:'line',
    data:{labels, datasets:[{data:values, borderColor:'#6aaae4', backgroundColor:'rgba(63,127,193,.28)',
      fill:true, tension:.35, pointBackgroundColor:pointColors, pointRadius:5, pointHoverRadius:7, borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      layout:{padding:{top:18}},
      onClick:(evt, els)=>{ if(els.length && onPick) onPick(tsList[els[0].index]); },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{display:false}},
      scales:{x:Object.assign({},AXIS.x,{grid:{display:false}}), y:Object.assign({},AXIS.y,{beginAtZero:true})}}
  });
}

// ================= table rendering =================
function bucketCls(b){ return b==='HOJE'?'tag-atrasado':b==='AMANHÃ'?'tag-amanha':b==='PRÓXIMOS 7 DIAS'?'tag-prox7':b==='ATRASADO'?'tag-atrasado':b==='FUTURO'?'tag-futuro':'c-muted'; }
function statusCls(s){ return s==='Atrasado'?'c-red':s==='No prazo'?'c-teal':s==='Cumprido com atraso'?'c-amber':s==='Cumprido no prazo'?'c-green':'c-muted'; }
function sortRows(rows, key, defCol, defDir){
  const st = sortState[key] || (sortState[key] = {col:defCol, dir:defDir||1});
  return rows.slice().sort((a,b)=>{
    let x = a[st.col], y = b[st.col];
    if(x instanceof Date) x = x.getTime(); if(y instanceof Date) y = y.getTime();
    if(x==null) x = st.dir===1 ? Infinity : -Infinity;
    if(y==null) y = st.dir===1 ? Infinity : -Infinity;
    if(typeof x==='string') x = x.toLowerCase();
    if(typeof y==='string') y = y.toLowerCase();
    return x<y ? -st.dir : x>y ? st.dir : 0;
  });
}
function buildTable(id, key, cols, rows, cellFn, maxH){
  const st = sortState[key] || {};
  const head = cols.map(c=>`<th data-col="${c.col}" style="width:${c.w}">${c.label}${st.col===c.col?`<span class="arrow">${st.dir===1?'▲':'▼'}</span>`:''}</th>`).join('');
  const body = rows.length
    ? rows.map((r,i)=>`<tr data-idx="${i}" class="${filters.resp.has(r.resp)?'row-active':''}">${cellFn(r)}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="empty">Nenhum registro com os filtros atuais.</td></tr>`;
  return `<div class="tbl-wrap" style="max-height:${maxH}px"><table id="${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function wireTable(id, key, rows){
  const t = document.getElementById(id);
  if(!t) return;
  t.querySelectorAll('th[data-col]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const col = th.dataset.col;
      const cur = sortState[key] || {col:null, dir:1};
      sortState[key] = {col, dir: cur.col===col ? -cur.dir : 1};
      render();
    });
  });
  t.querySelectorAll('tbody tr[data-idx]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const row = rows[+tr.dataset.idx];
      if(row) toggleSet(filters.resp, row.resp);
    });
  });
}

function grupoOrdem(dd){
  if(dd===0) return 1;
  if(dd===1) return 2;
  if(dd>1 && dd<=7) return 3;
  return 99;
}
function sortRowsGeral(rows, key){
  const st = sortState[key];
  if(st && st.col){ return sortRows(rows, key, st.col, st.dir); }
  return rows.slice().sort((a,b)=> grupoOrdem(a.dd)-grupoOrdem(b.dd) || a.dd-b.dd);
}

// ================= views =================
function viewGeral(rows){
  const ativos = rows.filter(r=>r.emAndamento && r.dd!==null);
  const hoje = ativos.filter(r=>r.dd===0).length;
  const d3 = ativos.filter(r=>r.dd>0 && r.dd<=3).length;
  const d7 = ativos.filter(r=>r.dd>0 && r.dd<=7).length;
  const atras = ativos.filter(r=>r.dd<0).length;

  const resp = countBy(ativos,'resp');
  const labels = [], vals = [], tsList = [];
  for(let i=1;i<=7;i++){ const d = new Date(); d.setDate(d.getDate()+i); labels.push(fmtShort(d)); vals.push(0); tsList.push(sod(d).getTime()); }
  ativos.forEach(r=>{ if(r.dd>0 && r.dd<=7) vals[r.dd-1]++; });

  const tbl = sortRowsGeral(ativos,'geral');

  document.getElementById('content').innerHTML = `
    <div class="row" style="grid-template-columns:repeat(5,1fr);">
      <div class="kpi k-white ${!filters.bucket?'k-active':''}" data-kpi="total"><div class="k-label">Total em aberto</div><div class="k-value">${ativos.length}</div></div>
      <div class="kpi k-red ${filters.bucket==='hoje'?'k-active':''}" data-kpi="hoje"><div class="k-label">Fatal hoje</div><div class="k-value">${hoje}</div></div>
      <div class="kpi k-amber ${filters.bucket==='d3'?'k-active':''}" data-kpi="d3"><div class="k-label">Fatal em 3 dias</div><div class="k-value">${d3}</div></div>
      <div class="kpi k-blue ${filters.bucket==='d7'?'k-active':''}" data-kpi="d7"><div class="k-label">Fatal em 7 dias</div><div class="k-value">${d7}</div></div>
      <div class="kpi k-gold ${filters.bucket==='atrasado'?'k-active':''}" data-kpi="atrasado"><div class="k-label">Atrasados</div><div class="k-value">${atras}</div></div>
    </div>
    <div class="row" style="grid-template-columns:1fr 1fr;">
      <div class="panel"><h3>Distribuição por responsável</h3>
        <div class="chart-box" style="height:170px;"><canvas id="cgResp"></canvas></div></div>
      <div class="panel"><h3>Próximos 7 dias</h3>
        <div class="chart-box" style="height:170px;"><canvas id="cgNext"></canvas></div></div>
    </div>
    <div class="panel">
      <h3>Agenda de prazos em aberto</h3>
      ${buildTable('tGeral','geral',[
        {col:'bucket',label:'D. Fatal',w:'13%'},{col:'statusPrazo',label:'Status',w:'11%'},
        {col:'fatal',label:'Data',w:'12%'},{col:'caso',label:'Caso',w:'40%'},{col:'resp',label:'Responsável',w:'24%'}
      ], tbl, r=>`
        <td class="${bucketCls(r.bucket)}">${esc(r.bucket)}</td>
        <td class="${statusCls(r.statusPrazo)}">${esc(r.statusPrazo)}</td>
        <td>${fmt(r.fatal)}</td>
        <td title="${esc(r.caso)}">${esc(r.caso)}</td>
        <td title="${esc(r.resp)}">${esc(r.resp)}</td>`, 620)}
    </div>`;

  hBar('cgResp', resp, filters.resp, v=>toggleSet(filters.resp, v), RESP_COLORS, RESP_DEFAULT);
  areaLine('cgNext', labels, vals, tsList, filters.dateFatal, ts=>toggleDateFatal(ts));
  wireTable('tGeral','geral', tbl);

  document.querySelectorAll('[data-kpi]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const k = el.dataset.kpi;
      if(k==='total') filters.bucket = null; else toggleBucket(k);
      render();
    });
  });
}

function viewHoje(rows){
  const hj = rows.filter(r=>r.emAndamento && r.dd===0);
  const resp = countBy(hj,'resp');
  const prov = countBy(hj,'titulo').slice(0,7);
  const area = countBy(hj,'area');
  const tbl = sortRows(hj,'hoje','resp',1);

  document.getElementById('content').innerHTML = `
    <div class="row" style="grid-template-columns:200px 1fr 1fr 1fr;">
      <div class="kpi k-red"><div class="k-label">Fatal hoje</div><div class="k-value">${hj.length}</div></div>
      <div class="panel"><h3>Fatal por responsável</h3>
        <div class="chart-box" style="height:${Math.max(140, resp.length*26)}px;"><canvas id="chResp"></canvas></div></div>
      <div class="panel"><h3>Contagem por providência</h3>
        <div class="chart-box" style="height:${Math.max(140, prov.length*26)}px;"><canvas id="chProv"></canvas></div></div>
      <div class="panel"><h3>Contagem por área</h3>
        <div class="chart-box" style="height:160px;"><canvas id="chArea"></canvas></div></div>
    </div>
    <div class="panel">
      <h3>Casos com prazo fatal hoje</h3>
      ${buildTable('tHoje','hoje',[
        {col:'caso',label:'Caso',w:'30%'},{col:'resp',label:'Responsável',w:'14%'},
        {col:'titulo',label:'Providência',w:'18%'},{col:'fatal',label:'Data fatal',w:'10%'},
        {col:'numero',label:'Processo',w:'14%'},{col:'juizo',label:'Juízo',w:'14%'}
      ], tbl, r=>`
        <td class="c-bold" title="${esc(r.caso)}">${esc(r.caso)}</td>
        <td class="c-bold">${esc(r.resp)}</td>
        <td class="c-bold">${esc(r.titulo)}</td>
        <td class="c-red">${fmt(r.fatal)}</td>
        <td title="${esc(r.numero)}">${esc(r.numero)}</td>
        <td title="${esc(r.juizo)}">${esc(r.juizo)}</td>`, 340)}
    </div>`;
  hBar('chResp', resp, filters.resp, v=>toggleSet(filters.resp, v), RESP_COLORS, RESP_DEFAULT);
  hBar('chProv', prov, filters.prov, v=>toggleSet(filters.prov, v), PROV_COLORS, PROV_DEFAULT);
  vBar('chArea', area, filters.area, v=>toggleSet(filters.area, v), AREA_COLORS);
  wireTable('tHoje','hoje', tbl);
}

function viewProx7(rows){
  const w = rows.filter(r=>r.emAndamento && r.dd!==null && r.dd>0 && r.dd<=7);
  const area = countBy(w,'area');
  const prov = countBy(w,'titulo').slice(0,8);
  const resp = countBy(w,'resp');
  const labels = [], vals = [], tsList = [];
  for(let i=1;i<=7;i++){ const d=new Date(); d.setDate(d.getDate()+i); labels.push(fmtShort(d)); vals.push(0); tsList.push(sod(d).getTime()); }
  w.forEach(r=>{ if(r.dd>0 && r.dd<=7) vals[r.dd-1]++; });
  const tbl = sortRows(w,'prox7','dd',1);

  document.getElementById('content').innerHTML = `
    <div class="row" style="grid-template-columns:200px 1fr 1.15fr 1fr;">
      <div class="kpi k-blue"><div class="k-label">Fatal em 7 dias</div><div class="k-value">${w.length}</div></div>
      <div class="panel"><h3>Contagem por área</h3>
        <div class="chart-box" style="height:180px;"><canvas id="c7Area"></canvas></div></div>
      <div class="panel"><h3>Contagem por providência</h3>
        <div class="chart-box" style="height:180px;"><canvas id="c7Prov"></canvas></div></div>
      <div class="panel"><h3>Fatal por responsável</h3>
        <div class="chart-box" style="height:180px;"><canvas id="c7Resp"></canvas></div></div>
    </div>
    <div class="row" style="grid-template-columns:1fr 1.35fr;">
      <div class="panel"><h3>Prazos por dia</h3>
        <div class="chart-box" style="height:260px;"><canvas id="c7Line"></canvas></div></div>
      <div class="panel"><h3>Casos nos próximos 7 dias</h3>
        ${buildTable('tP7','prox7',[
          {col:'bucket',label:'D. Fatal',w:'20%'},{col:'caso',label:'Caso',w:'52%'},{col:'resp',label:'Responsável',w:'28%'}
        ], tbl, r=>`
          <td class="${bucketCls(r.bucket)}">${esc(r.bucket)}</td>
          <td class="c-bold" title="${esc(r.caso)}">${esc(r.caso)}</td>
          <td title="${esc(r.resp)}">${esc(r.resp)}</td>`, 260)}
      </div>
    </div>`;
  vBar('c7Area', area, filters.area, v=>toggleSet(filters.area, v), AREA_COLORS);
  hBar('c7Prov', prov, filters.prov, v=>toggleSet(filters.prov, v), PROV_COLORS, PROV_DEFAULT);
  hBar('c7Resp', resp, filters.resp, v=>toggleSet(filters.resp, v), RESP_COLORS, RESP_DEFAULT);
  areaLine('c7Line', labels, vals, tsList, filters.dateFatal, ts=>toggleDateFatal(ts));
  wireTable('tP7','prox7', tbl);
}

function viewPerf(rows){
  const now = new Date();
  // Se o usuário já escolheu um mês no filtro global, 'rows' aqui já veio
  // restrito a esse mês (applyFilters) — não recalcular por cima com o mês
  // atual, senão o filtro de mês nunca funcionaria nesta aba.
  const base = filters.mes
    ? rows
    : (()=>{ const mes = rows.filter(r=>r.dataDate && r.dataDate.getMonth()===now.getMonth() && r.dataDate.getFullYear()===now.getFullYear());
              return mes.length ? mes : rows; })();
  const total = base.length;
  const done = base.filter(r=>!r.emAndamento).length;
  const taxa = total ? ((done/total)*100).toFixed(2).replace('.',',') : '0,00';

  const areas = [...new Set(base.map(r=>r.area))];
  const stack = areas.map(a=>{
    const sub = base.filter(r=>r.area===a);
    const c = sub.filter(r=>!r.emAndamento).length;
    return {area:a, pct_c: sub.length? c/sub.length*100:0, pct_a: sub.length? (sub.length-c)/sub.length*100:0};
  }).sort((a,b)=>b.pct_c-a.pct_c);

  const byDate = new Map();
  base.filter(r=>!r.emAndamento && r.conclusaoDate).forEach(r=>{
    const k = sod(r.conclusaoDate).getTime();
    byDate.set(k,(byDate.get(k)||0)+1);
  });
  const keys = [...byDate.keys()].sort((a,b)=>a-b).slice(-16);

  // Mesma base do card "Concluídos" e da tabela (mês em análise), para os números baterem.
  const concl = base.filter(r=>!r.emAndamento);
  const atrasoTotal = concl.filter(r=>r.statusPrazo==='Cumprido com atraso').length;
  const tbl = sortRows(base,'perf','conclusaoDate',-1);

  document.getElementById('content').innerHTML = `
    <div class="row" style="grid-template-columns:repeat(4,1fr);">
      <div class="kpi k-white" data-kpi="pTotal"><div class="k-label">Total no mês</div><div class="k-value">${total}</div></div>
      <div class="kpi k-white ${filters.status==='concluido'?'k-active':''}" data-kpi="pDone"><div class="k-label">Concluídos</div><div class="k-value">${done}</div></div>
      <div class="kpi k-blue"><div class="k-label">Taxa de conclusão</div><div class="k-value">${taxa}%</div></div>
      <div class="kpi k-amber ${filters.statusPrazo==='Cumprido com atraso'?'k-active':''}" data-kpi="pAtraso"><div class="k-label">Cumpridos com atraso</div><div class="k-value">${atrasoTotal}</div></div>
    </div>
    <div class="row" style="grid-template-columns:1fr 1.2fr 1.5fr;">
      <div class="panel"><h3>Contagem por status</h3>
        <div class="chart-box" style="height:210px;"><canvas id="cpDonut"></canvas></div></div>
      <div class="panel"><h3>Status por área</h3>
        <div class="chart-box" style="height:210px;"><canvas id="cpArea"></canvas></div></div>
      <div class="panel"><h3>Concluídos por data</h3>
        <div class="chart-box" style="height:210px;"><canvas id="cpDate"></canvas></div></div>
    </div>
    <div class="panel">
      <h3>Itens do mês</h3>
      ${buildTable('tPerf','perf',[
        {col:'resp',label:'Responsável',w:'14%'},{col:'numero',label:'Número do processo',w:'18%'},
        {col:'statusPrazo',label:'Status prazo',w:'13%'},{col:'fatal',label:'Data do prazo',w:'10%'},
        {col:'conclusaoDate',label:'Concluído em',w:'10%'},{col:'caso',label:'Caso',w:'35%'}
      ], tbl, r=>`
        <td class="c-bold">${esc(r.resp)}</td>
        <td>${esc(r.numero)}</td>
        <td class="${statusCls(r.statusPrazo)}">${esc(r.statusPrazo)}</td>
        <td>${fmt(r.fatal)}</td>
        <td>${fmt(r.conclusaoDate)}</td>
        <td title="${esc(r.caso)}">${esc(r.caso)}</td>`, 340)}
    </div>`;

  draw('cpDonut', {
    type:'doughnut',
    data:{labels:['Concluído: '+done, 'Em andamento: '+(total-done)], datasets:[{data:[done,total-done], backgroundColor:['#e3b04b','#6aaae4'], borderWidth:0}]},
    options:{cutout:'62%', responsive:true, maintainAspectRatio:false, animation:false,
      onClick:(evt, els)=>{ if(els.length){ const lbl = els[0].index===0?'concluido':'andamento'; toggleStatus(lbl); } },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{position:'right', labels:{color:'#9db0c8', font:{size:11}, boxWidth:12}},
        tooltip:{callbacks:{label:c=>`${c.label} (${total?(c.raw/total*100).toFixed(1):0}%)`}},
        valueLabel:false,
        centerText:{main:String(total), sub:'itens no mês'}}}
  });
  draw('cpArea', {
    type:'bar',
    data:{labels:stack.map(s=>s.area), datasets:[
      {label:'Concluído', data:stack.map(s=>s.pct_c), backgroundColor:'#e3b04b'},
      {label:'Em andamento', data:stack.map(s=>s.pct_a), backgroundColor:'#6aaae4'}
    ]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:false,
      onClick:(evt, els)=>{ if(els.length){ toggleSet(filters.area, stack[els[0].index].area); } },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{labels:{color:'#9db0c8', font:{size:11}, boxWidth:12}},
        tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${c.raw.toFixed(1)}%`}},
        valueLabel:{format:'percent', minValue:4}},
      scales:{x:Object.assign({},AXIS.x,{stacked:true, max:100, ticks:{color:'#9db0c8',font:{size:11},callback:v=>v+'%'}}),
              y:Object.assign({},AXIS.y,{stacked:true, grid:{display:false}})}}
  });
  draw('cpDate', {
    type:'bar',
    data:{labels:keys.map(k=>fmtShort(new Date(k))), datasets:[{
      data:keys.map(k=>byDate.get(k)),
      backgroundColor:keys.map(k=> filters.dateConcl===k ? '#ffffff' : '#6aaae4'),
      borderRadius:2, barPercentage:.6
    }]},
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      layout:{padding:{top:18}},
      onClick:(evt, els)=>{ if(els.length) toggleDateConcl(keys[els[0].index]); },
      onHover:(evt, els)=>{ if(evt.native && evt.native.target) evt.native.target.style.cursor = els.length ? 'pointer':'default'; },
      plugins:{legend:{display:false}},
      scales:{x:Object.assign({},AXIS.x,{grid:{display:false}}), y:Object.assign({},AXIS.y,{beginAtZero:true})}}
  });

  wireTable('tPerf','perf', tbl);

  document.querySelectorAll('[data-kpi]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const k = el.dataset.kpi;
      if(k==='pDone') toggleStatus('concluido');
      if(k==='pAtraso') toggleStatusPrazo('Cumprido com atraso');
      if(k==='pTotal'){ filters.status='todos'; filters.statusPrazo=null; document.getElementById('fStatus').value='todos'; render(); }
    });
  });
}

function viewEventos(rows){
  const hoje = rows.filter(r=>r.dd===0);
  const prox = rows.filter(r=>r.emAndamento && r.dd!==null && r.dd>=0 && r.dd<=7);
  const abertos = rows.filter(r=>r.emAndamento && r.dd!==null && r.dd>=0);
  const passados = rows.filter(r=>r.dd!==null && r.dd<0);
  const resp = countBy(rows.filter(r=>r.dd===null || r.dd>=0),'resp');
  const tbl = sortRows(rows,'eventos','ordem',1);

  document.getElementById('content').innerHTML = `
    <div class="row" style="grid-template-columns:repeat(4,1fr);">
      <div class="kpi k-red"><div class="k-label">Eventos hoje</div><div class="k-value">${hoje.length}</div></div>
      <div class="kpi k-blue"><div class="k-label">Próximos 7 dias</div><div class="k-value">${prox.length}</div></div>
      <div class="kpi k-white"><div class="k-label">A partir de hoje</div><div class="k-value">${abertos.length}</div></div>
      <div class="kpi k-amber"><div class="k-label">Já passaram</div><div class="k-value">${passados.length}</div></div>
    </div>
    <div class="row" style="grid-template-columns:1fr 2fr;">
      <div class="panel"><h3>Eventos por responsável (de hoje em diante)</h3>
        <div class="chart-box" style="height:${Math.max(140, resp.length*26)}px;"><canvas id="cvResp"></canvas></div></div>
      <div class="panel">
        <h3>Agenda de eventos (primeiro os de hoje em diante, depois os passados)</h3>
        ${buildTable('tEventos','eventos',[
          {col:'dataDate',label:'Data',w:'8%'},{col:'hora',label:'Hora',w:'5%'},
          {col:'tipo',label:'Tipo',w:'8%'},
          {col:'resp',label:'Responsável',w:'12%'},{col:'titulo',label:'Evento',w:'18%'},
          {col:'caso',label:'Caso',w:'22%'},{col:'numero',label:'Processo',w:'14%'},
          {col:'status',label:'Status',w:'13%'}
        ], tbl, r=>`
          <td class="${r.dd===0?'c-red':(r.dd!==null && r.dd>0 && r.dd<=7)?'c-teal':''} c-bold">${fmt(r.dataDate)}</td>
          <td>${esc(r.hora)}</td>
          <td>${esc(r.tipo)}</td>
          <td class="c-bold">${esc(r.resp)}</td>
          <td title="${esc(r.titulo)}">${esc(r.titulo)}</td>
          <td title="${esc(r.caso)}">${esc(r.caso)}</td>
          <td title="${esc(r.numero)}">${esc(r.numero)}</td>
          <td class="${r.emAndamento?'':'c-green'}">${esc(r.status)}</td>`, 340)}
      </div>
    </div>`;
  hBar('cvResp', resp, filters.resp, v=>toggleSet(filters.resp, v), RESP_COLORS, RESP_DEFAULT);
  wireTable('tEventos','eventos', tbl);
}

const VIEWS = {geral:viewGeral, hoje:viewHoje, prox7:viewProx7, perf:viewPerf, eventos:viewEventos};

function render(){
  renderChips();
  VIEWS[activeTab](applyFilters(activeTab==='eventos' ? enrichEventos(ROWS) : enrich(ROWS)));
}

// ================= filter UI =================
function buildMS(panelId, summaryId, values, set, allLabel){
  const panel = document.getElementById(panelId);
  panel.innerHTML = values.map(v=>
    `<label class="ms-opt"><input type="checkbox" value="${esc(v)}" ${set.has(v)?'checked':''}> ${esc(v)}</label>`).join('');
  panel.querySelectorAll('input').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      cb.checked ? set.add(cb.value) : set.delete(cb.value);
      syncFilterUI();
      render();
    });
  });
}
function initFilters(){
  const e = enrich(ROWS).concat(enrichEventos(ROWS));
  buildMS('msRespPanel','msRespSummary',[...new Set(e.map(r=>r.resp))].sort(), filters.resp, 'Todos');
  buildMS('msAreaPanel','msAreaSummary',[...new Set(e.map(r=>r.area))].sort(), filters.area, 'Todas');
  buildMS('msProvPanel','msProvSummary',[...new Set(e.map(r=>r.titulo))].sort(), filters.prov, 'Todas');
  buildMonthOptions(e);
}
function buildMonthOptions(enrichedRows){
  const keys = [...new Set(enrichedRows.filter(r=>r.dataDate).map(r=>monthKey(r.dataDate)))].sort();
  const sel = document.getElementById('fMes');
  if(filters.mes && !keys.includes(filters.mes)) keys.push(filters.mes);
  const cur = filters.mes;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    keys.sort().map(k=>`<option value="${k}" ${k===cur?'selected':''}>${esc(monthLabel(k))}</option>`).join('');
}
['msRespSummary','msAreaSummary','msProvSummary'].forEach((sid,i)=>{
  const pid = ['msRespPanel','msAreaPanel','msProvPanel'][i];
  const s = document.getElementById(sid), p = document.getElementById(pid);
  const toggle = e=>{ e.stopPropagation();
    document.querySelectorAll('.ms-panel').forEach(x=>{ if(x!==p) x.classList.remove('open'); });
    p.classList.toggle('open'); };
  s.addEventListener('click', toggle);
  s.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') toggle(e); });
  p.addEventListener('click', e=>e.stopPropagation());
});
document.addEventListener('click', ()=> document.querySelectorAll('.ms-panel').forEach(p=>p.classList.remove('open')));

document.getElementById('fStatus').addEventListener('change', e=>{ filters.status=e.target.value; render(); });
document.getElementById('fMes').addEventListener('change', e=>{ filters.mes=e.target.value; render(); });
document.getElementById('fSearch').addEventListener('input', e=>{ filters.search=e.target.value; render(); });
document.getElementById('clearFilters').addEventListener('click', ()=>{
  filters.resp.clear(); filters.area.clear(); filters.prov.clear();
  filters.status='todos'; filters.search=''; filters.bucket=null;
  filters.dateFatal=null; filters.dateConcl=null; filters.statusPrazo=null; filters.mes='';
  document.getElementById('fStatus').value='todos';
  document.getElementById('fMes').value='';
  document.getElementById('fSearch').value='';
  syncFilterUI();
  document.querySelectorAll('.ms-panel input').forEach(cb=>cb.checked=false);
  render();
});

// ================= tabs + rotation =================
function setTab(tab){
  activeTab = tab;
  filters.bucket = null; filters.dateFatal = null; filters.dateConcl = null; filters.statusPrazo = null;
  document.querySelectorAll('.tab-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('subtitle').textContent = SUBTITLES[tab];
  document.getElementById('subtitle').style.color =
    tab==='hoje' ? 'var(--red)' : tab==='prox7' ? 'var(--blue)' : '#ffffff';
  render();
}
document.querySelectorAll('.tab-btn').forEach(b=>{
  b.addEventListener('click', ()=>{ setTab(b.dataset.tab); });
});

const countEl = document.getElementById('rotateCount');
function startRotate(){
  stopRotate();
  rotateSeconds = rotateLen;
  countEl.textContent = rotateSeconds + 's';
  rotateTimer = setInterval(()=>{
    rotateSeconds--;
    if(rotateSeconds <= 0){
      const next = TAB_ORDER[(TAB_ORDER.indexOf(activeTab)+1) % TAB_ORDER.length];
      setTab(next);
      rotateSeconds = rotateLen;
    }
    countEl.textContent = rotateSeconds + 's';
  }, 1000);
}
function stopRotate(){ if(rotateTimer){ clearInterval(rotateTimer); rotateTimer = null; } countEl.textContent = ''; }
document.getElementById('rotateToggle').addEventListener('change', e=>{ e.target.checked ? startRotate() : stopRotate(); });
document.getElementById('rotateInterval').addEventListener('change', e=>{
  rotateLen = +e.target.value;
  if(document.getElementById('rotateToggle').checked) startRotate();
});
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ if(rotateTimer){ clearInterval(rotateTimer); rotateTimer=null; } }
  else if(document.getElementById('rotateToggle').checked && !rotateTimer) startRotate();
});

// ================= import (hidden) =================
const overlay = document.getElementById('importModal');
document.getElementById('hiddenTrigger').addEventListener('click', ()=>{
  document.getElementById('importStatus').textContent='';
  document.getElementById('importFile').value='';
  overlay.classList.add('open');
});
document.getElementById('importCancel').addEventListener('click', ()=> overlay.classList.remove('open'));
overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.classList.remove('open'); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') overlay.classList.remove('open'); });

function normalize(json){
  return json.map(r=>({
    data:String(r[COLS.data]||'').trim(), d1:String(r[COLS.d1]||'').trim(), tipo:String(r[COLS.tipo]||'').trim(),
    resp:String(r[COLS.resp]||'Sem responsável').trim(), titulo:String(r[COLS.titulo]||'Sem providência').trim(),
    caso:String(r[COLS.caso]||'').trim(), numero:String(r[COLS.numero]||'').trim(),
    juizo:String(r[COLS.juizo]||'').trim(), status:String(r[COLS.status]||'').trim(),
    conclusao:String(r[COLS.conclusao]||'').trim(), hora:String(r[COLS.hora]||'').trim()
  })).filter(r=>r.data);
}
document.getElementById('importConfirm').addEventListener('click', async ()=>{
  const st = document.getElementById('importStatus');
  const f = document.getElementById('importFile').files[0];
  if(!f){ st.textContent='Selecione um arquivo.'; st.className='m-status err'; return; }
  st.textContent='Lendo planilha...'; st.className='m-status';
  try{
    const wb = XLSX.read(await f.arrayBuffer(), {type:'array'});
    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
    const rows = normalize(json);
    if(!rows.length){ st.textContent='Nenhuma linha reconhecida. Confira o cabeçalho da planilha.'; st.className='m-status err'; return; }
    st.textContent = 'Gravando ' + rows.length + ' registros...';
    const iso = new Date().toISOString();
    const r = await fetch('/api/bi-prazos/carga', {method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body: JSON.stringify({updatedAt: iso, rows: rows.filter(x=>/^(prazo|evento|audi)/.test(String(x.tipo||'prazo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())).map(x=>({tipo:x.tipo||'Prazo', data:x.data, hora:x.hora, caso:x.caso, conclusao:x.conclusao, juizo:x.juizo, numero:x.numero, resp:x.resp, status:x.status, titulo:x.titulo}))})});
    if(!r.ok){ const e = await r.json().catch(()=>({})); throw new Error(e.erro || ('HTTP ' + r.status)); }
    await carregar();
    try { parent.postMessage({ nga: 'bi-carregado' }, location.origin); } catch (e) {}
    st.textContent = rows.length + ' registros atualizados.'; st.className='m-status ok';
    setTimeout(()=> overlay.classList.remove('open'), 900);
  }catch(err){
    st.textContent = 'Erro: ' + err.message; st.className='m-status err';
  }
});

function setUpdatedLabel(){
  const el = document.getElementById('updatedAt');
  const headerEl = document.getElementById('updatedLine');
  if(!UPDATED_AT){
    el.textContent = ROWS.length + ' registros carregados da base inicial.';
    headerEl.textContent = '';
    return;
  }
  const d = new Date(UPDATED_AT);
  const hhmm = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  el.textContent = ROWS.length + ' registros. Atualizado em ' + fmt(d) + ' às ' + hhmm;
  headerEl.textContent = 'Atualizado às ' + hhmm;
}

// ================= boot =================
document.getElementById('todayBox').textContent = fmt(new Date());
initFilters();
setTab('geral');
setUpdatedLabel();

// Modo TV: se o rodízio já vier ligado (padrão), começa sozinho, sem precisar
// que alguém clique no interruptor.
if(document.getElementById('rotateToggle').checked) startRotate();

// Recarrega a página periodicamente (a cada 10 minutos), o "F5 automático".
// Isso serve principalmente para quem vê sem estar logado (TV do escritório,
// aba anônima) e por isso só enxerga os dados fixados na última publicação:
// o reload periódico garante que, pouco depois de cada republicação da
// automação, a tela pegue os dados novos sozinha, sem precisar que alguém
// aperte F5. Quem está logado já atualiza ao vivo via banco de dados,
// independente deste reload.
// Os dados chegam pela API do LAB (abaixo), a cada 2 minutos: sem recarregar a página inteira.

// ================= banco em partes =================
// O banco do artefato aceita no máximo 256 KiB por documento. Para a base de prazos
// poder crescer sem bater nesse teto, as linhas ficam divididas em vários documentos:
//   prazos_rows/s000, s001, ...  ->  {idx, stamp, rows:[...]}   (SHARD_SIZE linhas cada)
//   prazos/base                  ->  índice {format:2, shards:[ids], total, updatedAt}
// Cada parte carrega um "stamp" igual ao updatedAt do índice. O painel só troca os dados
// quando todas as partes listadas no índice existem com esse mesmo stamp, então uma
// gravação em andamento nunca aparece pela metade. O formato antigo (prazos/base com
// "rows" direto) continua sendo lido normalmente.
const META_PATH = 'prazos/base';
const SHARD_COL = 'prazos_rows';
const SHARD_SIZE = 200;
const NOTA = 'Formato 2: as linhas ficam em prazos_rows/s000, s001... ({idx, stamp, rows}), ' +
  SHARD_SIZE + ' linhas por documento. Ao atualizar, regravar TODAS as partes com stamp igual ao ' +
  'updatedAt deste indice e gravar este indice por ultimo. Limite do banco: 256 KiB por documento.';
let META = null, SHARDS = {}, APPLIED = null;

async function writeRowsSharded(rows, iso){
  const n = Math.ceil(rows.length / SHARD_SIZE);
  const ids = [];
  for(let i=0;i<n;i++){
    const id = 's' + String(i).padStart(3,'0');
    ids.push(id);
    await DB.doc(SHARD_COL + '/' + id).set({idx:i, stamp:iso, rows:rows.slice(i*SHARD_SIZE, (i+1)*SHARD_SIZE)});
  }
  await DB.doc(META_PATH).set({format:2, shards:ids, total:rows.length, updatedAt:iso, nota:NOTA});
  try{
    const all = await DB.collection(SHARD_COL).get();
    for(const d of all.docs){ if(!ids.includes(d.id)) await DB.doc(SHARD_COL + '/' + d.id).delete(); }
  }catch(e){ /* sobras de partes antigas não atrapalham a leitura */ }
}

function applyRows(rows, iso){
  if(!Array.isArray(rows) || !rows.length) return;
  const key = (iso || '') + '|' + rows.length;
  if(key === APPLIED) return;
  APPLIED = key;
  ROWS = rows;
  UPDATED_AT = iso || null;
  initFilters();
  setUpdatedLabel();
  render();
}

function applyMeta(){
  if(!META) return;
  if(Array.isArray(META.rows)){ applyRows(META.rows, META.updatedAt); return; }   // formato antigo
  if(!Array.isArray(META.shards)) return;
  const parts = [];
  for(const id of META.shards){
    const sh = SHARDS[id];
    if(!sh || sh.stamp !== META.updatedAt || !Array.isArray(sh.rows)) return;      // conjunto incompleto: aguarda
    parts.push(sh.rows);
  }
  applyRows([].concat.apply([], parts), META.updatedAt);
}

// ================= dados do LAB =================
// Logado no LAB: /api/bi-prazos com a sessão. TV sem sessão: credencial de exibição (?tv=... na primeira
// abertura; fica guardada neste navegador). A automação do Astrea atualiza a base; aqui só se lê.
const CHAVE_TV = 'nga_bi_tv';
(function(){ try{ const u = new URL(location.href); const t = u.searchParams.get('tv'); if(t){ localStorage.setItem(CHAVE_TV, t); u.searchParams.delete('tv'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } }catch(e){} })();
let FALHAS = 0;
async function carregar(){
  let r = null;
  try{ r = await fetch('/api/bi-prazos', {credentials:'same-origin', cache:'no-store'}); }catch(e){ r = null; }
  if(!r || !r.ok){
    let t = null; try{ t = localStorage.getItem(CHAVE_TV); }catch(e){}
    if(t){ try{ r = await fetch('/api/bi-prazos/tv', {headers:{'x-nga-tv': t}, cache:'no-store'}); }catch(e){ r = null; } }
  }
  const aviso = document.getElementById('updatedAt');
  if(!r || !r.ok){
    FALHAS++;
    if(!ROWS.length && aviso) aviso.textContent = r && r.status === 401 ? 'Sem acesso: entre no LAB ou abra o link de TV gerado no BI de Prazos.' : 'Sem conexão com o LAB. Tentando de novo…';
    return;
  }
  FALHAS = 0;
  const d = await r.json();
  if(Array.isArray(d.rows) && d.rows.length){ APPLIED = null; applyRows(d.rows, d.updatedAt); }
  else if(aviso && !ROWS.length) aviso.textContent = 'A base ainda não recebeu a primeira carga da automação do Astrea.';
}
carregar();
setInterval(carregar, 2 * 60 * 1000);
// Virada do dia na TV: a data do topo e "Prazos hoje" acompanham sem precisar recarregar.
let DIA = new Date().toDateString();
setInterval(function(){ if(new Date().toDateString() !== DIA){ DIA = new Date().toDateString(); document.getElementById('todayBox').textContent = fmt(new Date()); render(); } }, 60 * 1000);

})();
