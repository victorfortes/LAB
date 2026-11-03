const $ = (s) => document.querySelector(s);
const app = $("#app");

/** Cria elementos sem innerHTML: todo texto vindo do servidor entra como textContent. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { "content-type": "application/json" } : {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString("pt-BR")), 1000);
$("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };

const STATUS = {
  queued: "Na fila", awaiting_human: "Aguardando você", capturing: "Capturando", splitting: "Dividindo",
  split_done: "Dividido", uploading: "Enviando", analyzing: "Analisando", review_ready: "Pronto p/ revisão", failed: "Falhou",
};
const STEPS = [["Captura", ["queued", "capturing", "awaiting_human"]], ["Preparo", []], ["Recorte", ["splitting"]],
  ["Envio", ["uploading"]], ["Triagem", ["analyzing"]]];
const stepIndex = (s) => ({ queued: 0, capturing: 0, awaiting_human: 0, splitting: 2, split_done: 3, uploading: 3, analyzing: 4, review_ready: 5 })[s] ?? 0;

let state, poll, currentJob;

async function boot() {
  state = await api("/api/state");
  $("#logout").hidden = !state.user;
  if (!state.user) return renderAuth();
  renderHome();
}

function renderAuth() {
  clearInterval(poll);
  const u = h("input", { placeholder: "usuário", autocomplete: "username" });
  const p = h("input", { type: "password", placeholder: state.needsSetup ? "senha (mín. 12 caracteres)" : "senha", autocomplete: state.needsSetup ? "new-password" : "current-password" });
  const err = h("div", { class: "note bad", hidden: true });
  const go = async () => {
    try {
      await api(state.needsSetup ? "/api/register" : "/api/login", { method: "POST", body: JSON.stringify({ username: u.value, password: p.value }) });
      boot();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  };
  p.addEventListener("keydown", (e) => e.key === "Enter" && go());
  app.replaceChildren(
    h("div", { class: "tag" }, "03 // projeto // em desenvolvimento"),
    h("h1", {}, "NGA Íntegra"),
    h("p", { class: "lead" }, "Informe o processo. O agente captura a íntegra, divide em partes de até 20 MB e prepara a triagem jurídica preliminar."),
    h("div", { class: "panel", style: "max-width:420px" },
      h("h2", {}, state.needsSetup ? "Crie seu acesso local" : "Entrar"),
      h("label", {}, "Usuário"), u, h("label", {}, "Senha"), p, err,
      h("p", {}, h("button", { class: "primary", onclick: go }, state.needsSetup ? "Criar acesso" : "Entrar"))),
  );
}

async function renderHome() {
  clearInterval(poll);
  currentJob = null;
  const jobs = await api("/api/jobs");
  const rows = jobs.map((j) =>
    h("tr", { class: "click", onclick: () => openJob(j.id) },
      h("td", {}, j.caseName), h("td", {}, j.cnj), h("td", {}, j.sistema),
      h("td", {}, h("span", { class: `pill ${j.status}` }, STATUS[j.status] ?? j.status)),
      h("td", {}, new Date(j.createdAt).toLocaleString("pt-BR"))));
  app.replaceChildren(
    h("div", { class: "tag" }, "03 // projeto // em desenvolvimento"),
    h("h1", {}, "NGA Íntegra"),
    h("p", { class: "lead" }, "Processo → captura da íntegra → divisão em partes ≤ 20 MB → triagem preliminar. Cada afirmação aponta arquivo e página. Revisão humana obrigatória."),
    !state.hasApiKey && h("div", { class: "note" }, "Chave da API Anthropic ausente: o fluxo para na divisão e a triagem automática não roda. Configure com: bun run set-key"),
    h("p", {}, h("button", { class: "primary", onclick: newProcessModal }, "+ Buscar novo processo")),
    h("div", { class: "panel" }, jobs.length
      ? h("table", { class: "jobs" }, h("tr", {}, ["Caso", "Processo", "Sistema", "Situação", "Criado"].map((t) => h("th", {}, t))), rows)
      : h("p", { class: "lead" }, "Nenhum processo ainda.")),
  );
}

function newProcessModal() {
  const numero = h("input", { placeholder: "0000000-00.0000.0.00.0000", inputmode: "numeric" });
  const caseName = h("input", { placeholder: "ex.: Montano" });
  const side = h("select", {}, ["Credor / exequente", "Devedor / executado", "Autor", "Réu", "Outro"].map((o) => h("option", {}, o)));
  const mode = h("select", {},
    h("option", { value: "importacao" }, "Importar PDFs que eu já baixei"),
    h("option", { value: "assistida" }, "Agente no tribunal (token digital)"));
  const sistema = h("select", {}, ["projudi", "eproc", "pje", "esaj", "outro"].map((s) => h("option", { value: s }, s.toUpperCase())));
  const url = h("input", { placeholder: "https://…" });
  const info = h("div");
  const err = h("div", { class: "note bad", hidden: true });
  let timer;
  const resolve = async () => {
    info.replaceChildren();
    if (numero.value.replace(/\D/g, "").length !== 20) return;
    try {
      const r = await api(`/api/resolve?numero=${encodeURIComponent(numero.value)}`);
      if (r.tribunal) { sistema.value = r.tribunal.sistema; url.value = r.tribunal.url; }
      info.replaceChildren(
        h("div", { class: "tag" }, r.tribunal ? `${r.tribunal.sigla} · ${r.tribunal.sistema.toUpperCase()}${r.tribunal.verificado ? " · endereço verificado" : ""}` : "Tribunal não localizado"),
        ...r.avisos.map((a) => h("div", { class: "note" }, a)));
    } catch (e) { info.replaceChildren(h("div", { class: "note bad" }, e.message)); }
  };
  numero.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(resolve, 250); });
  const submit = h("button", { class: "primary", onclick: async () => {
    try {
      const r = await api("/api/jobs", { method: "POST", body: JSON.stringify({
        numero: numero.value, caseName: caseName.value, side: side.value, mode: mode.value, sistema: sistema.value, url: url.value }) });
      modal.remove();
      openJob(r.job.id);
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  } }, "Buscar e dividir");
  const modal = h("div", { class: "modal", onclick: (e) => e.target === modal && modal.remove() },
    h("div", { class: "panel" },
      h("div", { class: "tag" }, "Novo processo"), h("h2", {}, "Buscar novo processo"),
      h("label", {}, "Número CNJ"), numero, info,
      h("label", {}, "Nome do caso"), caseName,
      h("label", {}, "Polo representado"), side,
      h("label", {}, "Captura"), mode,
      h("label", {}, "Sistema do tribunal"), sistema,
      h("label", {}, "Endereço do sistema (confira antes de autenticar)"), url,
      err, h("p", { class: "row" }, h("button", { onclick: () => modal.remove() }, "Cancelar"), submit)));
  document.body.append(modal);
  numero.focus();
}

async function openJob(id) {
  clearInterval(poll);
  currentJob = id;
  const draw = async () => {
    if (currentJob !== id) return;
    const d = await api(`/api/jobs/${id}`);
    renderJob(d);
    const busy = !["review_ready", "failed", "split_done"].includes(d.job.status);
    if (!busy && d.job.status !== "queued") clearInterval(poll);
  };
  await draw();
  poll = setInterval(() => draw().catch(() => {}), 1500);
}

function renderJob({ job, events, manifest, hasTriage }) {
  const lock = $("#lock");
  lock.hidden = job.status !== "awaiting_human" || !!document.querySelector("[data-upload]");
  $("#lock-msg").textContent = job.humanPrompt ?? "";
  $("#lock-ok").onclick = async () => { await api(`/api/jobs/${job.id}/release`, { method: "POST" }); };

  const idx = stepIndex(job.status);
  const steps = STEPS.map(([name], i) =>
    h("div", { class: `step ${job.status === "failed" && i === idx ? "err" : i < idx ? "done" : i === idx && job.status !== "split_done" ? "now" : ""}` }, `${String(i + 1).padStart(2, "0")} ${name}`));

  let upload = null;
  if (job.status === "queued") {
    const files = h("input", { type: "file", accept: "application/pdf", multiple: true, "data-upload": true });
    const go = h("button", { class: "primary", onclick: async () => {
      go.disabled = true;
      try {
        const fd = new FormData();
        for (const f of files.files) fd.append("files", f);
        await api(`/api/jobs/${job.id}/upload`, { method: "POST", body: fd });
        await api(`/api/jobs/${job.id}/start`, { method: "POST" });
      } catch (e) { alert(e.message); go.disabled = false; }
    } }, "Enviar e dividir");
    upload = h("div", { class: "panel" }, h("div", { class: "tag" }, "Importação"), h("p", {}, "Selecione os PDFs da íntegra (todos os volumes, em ordem)."), files, h("p", {}, go));
  }

  const term = h("div", { class: "term" }, events.map((e) => h("div", {}, h("span", { class: "t" }, new Date(e.at).toLocaleTimeString("pt-BR") + " "), `[${e.kind}] ${e.message}`)));
  const dl = (rel, label) => h("a", { href: `/api/jobs/${job.id}/file/${rel}` }, label);

  app.replaceChildren(
    h("p", {}, h("button", { class: "ghost", onclick: renderHome }, "← voltar")),
    h("div", { class: "tag" }, `${job.sistema} · ${job.cnj}`),
    h("h1", {}, job.caseName),
    h("p", {}, h("span", { class: `pill ${job.status}` }, STATUS[job.status] ?? job.status), "  ", job.side),
    job.error && h("div", { class: "note bad" }, job.error),
    h("div", { class: "steps" }, steps),
    upload,
    manifest && h("div", { class: "panel" },
      h("div", { class: "tag" }, `${manifest.parts.length} partes · ${manifest.sources.reduce((a, s) => a + s.pages, 0)} páginas · máx. ${(manifest.maxBytes / 1e6).toFixed(0)} MB`),
      h("div", { class: "note" }, "Sem OCR e sem índice de eventos. Páginas do manifesto referem-se ao PDF original. A divisão regrava os PDFs e não preserva assinaturas digitais."),
      h("table", { class: "parts" }, h("tr", {}, ["Parte", "Págs. originais", "MB"].map((t) => h("th", {}, t))),
        manifest.parts.map((p) => h("tr", {}, h("td", {}, dl(`partes/${p.name}`, p.name)), h("td", {}, `${p.originalPageStart}–${p.originalPageEnd}`), h("td", {}, (p.bytes / 1e6).toFixed(1)))))),
    h("div", { class: "panel" }, h("div", { class: "tag" }, "Entregas"),
      h("p", {}, dl("partes/manifesto.json", "manifesto.json"), " · ", dl("partes/roteiro-triagem.md", "roteiro-triagem.md"),
        hasTriage && [" · ", dl("triagem-preliminar.md", "triagem-preliminar.md")]),
      hasTriage && h("div", { class: "note" }, "Triagem preliminar gerada por IA: confira cada citação de página antes de usar. Não substitui a análise do advogado.")),
    term,
  );
}

boot();
