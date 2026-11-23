/**
 * Narração do portal com a voz do próprio navegador (Web Speech API, `speechSynthesis`).
 *
 * É a "ferramenta gratuita" de voz de IA: já vem no Chrome, Edge, Safari e no Android/iOS, não tem chave, não tem
 * servidor e não cobra por uso. O cliente que prefere ouvir a ler aperta "Ouvir" e o portal lê o guia em voz alta,
 * em português. Deixa o primeiro acesso mais fluido (e mais acessível) sem depender de nenhum serviço pago.
 *
 * Cuidados conhecidos da API, todos tratados aqui:
 *  - as vozes carregam de forma assíncrona (evento `voiceschanged`);
 *  - um texto longo numa única fala é cortado em alguns navegadores — quebramos por frase;
 *  - o Chrome pausa a fala sozinho depois de ~15s — `resume()` periódico mantém andando;
 *  - nada toca sem o clique do cliente (navegadores bloqueiam áudio automático, e é o certo).
 */
const sintese = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const falaDisponivel = () => !!sintese && typeof SpeechSynthesisUtterance !== 'undefined';

let vozes = [];
function carregarVozes() { if (sintese) vozes = sintese.getVoices() || []; }
if (sintese) { carregarVozes(); try { sintese.addEventListener('voiceschanged', carregarVozes); } catch { /* Safari antigo */ } }

/** Melhor voz em português disponível: prefere pt-BR e, entre elas, as mais naturais. */
function vozPtBr() {
  if (!vozes.length) carregarVozes();
  const ptBr = vozes.filter((v) => /^pt[-_]?br/i.test(v.lang));
  const lista = ptBr.length ? ptBr : vozes.filter((v) => /^pt/i.test(v.lang));
  const prefere = /(luciana|francisca|microsoft|google|natural|premium|enhanced|maria|camila|vit[oó]ria)/i;
  return lista.find((v) => prefere.test(v.name)) || lista[0] || null;
}

/** Quebra o texto em frases curtas: fala longa é cortada em alguns navegadores. */
function emFrases(texto) {
  const limpo = String(texto).replace(/\s+/g, ' ').trim();
  const brutos = limpo.match(/[^.!?:;]+[.!?:;]*\s*/g) || [limpo];
  const out = [];
  for (const b of brutos) {
    const f = b.trim(); if (!f) continue;
    if (f.length <= 220) out.push(f);
    else for (const p of f.match(/.{1,220}(\s|$)/g) || [f]) { const x = p.trim(); if (x) out.push(x); }
  }
  return out;
}

let manterVivo = null;
const pararKeepAlive = () => { if (manterVivo) { clearInterval(manterVivo); manterVivo = null; } };

/** Para qualquer narração em andamento. */
export function parar() { pararKeepAlive(); if (sintese) { try { sintese.cancel(); } catch { /* ignore */ } } }

/**
 * Lê o texto em voz alta. `aoFim` é chamado quando termina naturalmente; `aoProgresso(feito, total)` a cada frase.
 * Devolve um controle com `.parar()`. Sem suporte no navegador, não faz nada (e chama `aoFim`).
 */
export function falar(texto, { aoFim, aoProgresso } = {}) {
  if (!falaDisponivel()) { aoFim?.(); return { parar() {} }; }
  parar();
  const frases = emFrases(texto); const voz = vozPtBr();
  let idx = 0, cancelado = false;
  const diz = () => {
    if (cancelado) return;
    if (idx >= frases.length) { pararKeepAlive(); aoFim?.(); return; }
    const u = new SpeechSynthesisUtterance(frases[idx]);
    if (voz) u.voice = voz; u.lang = (voz && voz.lang) || 'pt-BR'; u.rate = 1; u.pitch = 1;
    u.onend = () => { if (cancelado) return; idx++; aoProgresso?.(idx, frases.length); diz(); };
    u.onerror = () => { if (cancelado) return; idx++; diz(); };
    sintese.speak(u);
  };
  pararKeepAlive();
  manterVivo = setInterval(() => { if (sintese.speaking && !sintese.paused) { try { sintese.resume(); } catch { /* ignore */ } } }, 8000);
  diz();
  return { parar() { cancelado = true; pararKeepAlive(); try { sintese.cancel(); } catch { /* ignore */ } } };
}
