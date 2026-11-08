/**
 * Estado real das ferramentas do NGA Lab.
 *
 * O ecossistema é feito de aplicações que continuam separadas (decisão
 * tomada, e mantida): Prazos, Íntegra e Sentinela rodam cada uma no seu
 * processo. Esta tela não finge integração — ela PERGUNTA a cada uma se está
 * de pé e diz o que respondeu. Card decorativo que mostra "online" sem ter
 * conferido é exatamente o que o §18 proíbe.
 *
 * Duas conferências distintas, que não se confundem:
 *   - `noAr`: a aplicação respondeu a um GET agora;
 *   - `ligadaAoLab`: existe credencial de integração ativa para ela e já
 *     entregou algo. Uma ferramenta pode estar no ar e não estar ligada.
 */
import type { PoolClient } from 'pg';

export interface Ferramenta {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string;
  readonly aplicacao: 'prazos' | 'integra' | 'sentinela' | 'radar' | 'painel' | 'relatorios';
  /** Endereço para abrir e para sondar; nulo quando não há interface. */
  readonly url: string | null;
  readonly estado: 'entregue' | 'em_uso' | 'em_desenvolvimento';
  /** Caminho na MESMA origem do NGA LAB, para abrir dentro da tela (iframe) sem violar frame-ancestors. */
  readonly caminho?: string;
  /** Aplicação com login e banco próprios: não entrega dados ao Lab, e isso é o desenho, não uma falha. */
  readonly independente?: boolean;
  /** A aplicação se recusa a abrir dentro de outra página (defesa própria contra clickjacking). */
  readonly semIncorporar?: boolean;
}

function url(env: string, padrao: string): string {
  return (process.env[env] ?? padrao).replace(/\/$/, '');
}

export function catalogo(): readonly Ferramenta[] {
  return [
    {
      id: 'prazos', aplicacao: 'prazos', estado: 'em_uso',
      nome: 'NGA Prazos',
      descricao: 'Agenda e auditoria de prazos, com leitura do Astrea.',
      url: url('NGA_URL_PRAZOS', 'http://127.0.0.1:8787'),
    },
    {
      id: 'sentinela', aplicacao: 'sentinela', estado: 'em_uso',
      nome: 'NGA Sentinela',
      descricao: 'Monitora novas ações contra clientes no DJEN e no DataJud.',
      url: url('NGA_URL_SENTINELA', 'http://127.0.0.1:8000'),
    },
    {
      id: 'integra', aplicacao: 'integra', estado: 'em_uso',
      nome: 'NGA Íntegra',
      descricao: 'Captura a íntegra dos autos e divide em partes para triagem.',
      url: url('NGA_URL_INTEGRA', 'http://127.0.0.1:8791'),
    },
    {
      id: 'relatorios', aplicacao: 'relatorios', estado: 'em_uso', independente: true, semIncorporar: true,
      nome: 'NGA Relatórios',
      descricao: 'Gerador de relatórios jurídicos da NGA, com login individual e banco próprio no Supabase.',
      // Servido por este mesmo servidor, sob /gerador/ (ver estaticos.ts). Abre em nova aba: não aceita iframe.
      url: `${url('NGA_URL_RELATORIOS', 'https://nga-lab-launchpad.lovable.app/gerador')}/`,
      caminho: '/gerador/',
    },
    {
      id: 'radar', aplicacao: 'radar', estado: 'em_uso', independente: true, semIncorporar: true,
      nome: 'Radar de RJs e Falências',
      descricao: 'Radar Concursal: descobertas no DJEN, processos e credores. Coleta diária pelo serviço do Mac.',
      url: url('NGA_URL_RADAR', 'https://judy-track-pro.lovable.app'),
    },
  ];
}

async function sondar(endereco: string): Promise<{ noAr: boolean; ms: number | null; titulo: string | null }> {
  const inicio = performance.now();
  try {
    const r = await fetch(endereco, { signal: AbortSignal.timeout(endereco.startsWith('https://') ? 6000 : 2000), redirect: 'manual' });
    const ms = Math.round(performance.now() - inicio);
    // Qualquer resposta HTTP prova que há alguém escutando; só falha de
    // conexão ou tempo esgotado conta como fora do ar.
    const corpo = r.headers.get('content-type')?.includes('text/html') ? await r.text().catch(() => '') : '';
    const titulo = /<title>([^<]*)<\/title>/i.exec(corpo)?.[1]?.trim() ?? null;
    return { noAr: r.status >= 200 && r.status < 400, ms, titulo };
  } catch {
    return { noAr: false, ms: null, titulo: null };
  }
}

export async function estado(db: PoolClient) {
  const { rows: credenciais } = await db.query<{
    aplicacao: string; usos: number; ultimo_uso_em: Date | null;
  }>(
    `SELECT aplicacao, sum(usos)::int AS usos, max(ultimo_uso_em) AS ultimo_uso_em
       FROM integracoes WHERE revogada_em IS NULL GROUP BY aplicacao`);
  const porApp = new Map(credenciais.map((c) => [c.aplicacao, c]));

  const itens = await Promise.all(catalogo().map(async (f) => {
    const sonda = f.url ? await sondar(f.url) : { noAr: false, ms: null, titulo: null };
    const credencial = porApp.get(f.aplicacao);
    return {
      ...f,
      noAr: sonda.noAr,
      latenciaMs: sonda.ms,
      tituloDaPagina: sonda.titulo,
      semInterface: f.url === null,
      ligadaAoLab: (credencial?.usos ?? 0) > 0,
      credencialCriada: credencial !== undefined,
      entregas: credencial?.usos ?? 0,
      ultimaEntrega: credencial?.ultimo_uso_em ?? null,
    };
  }));
  return { verificadoEm: new Date().toISOString(), ferramentas: itens };
}
