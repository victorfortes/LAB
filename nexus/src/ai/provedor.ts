/**
 * Acesso ao modelo de linguagem — real, e honesto quando não há acesso.
 *
 * O §22 do briefing é explícito: "Não invente credenciais, não simule
 * resultados e não afirme que uma integração está funcionando sem testá-la" e
 * "Quando houver limitações de acesso, API, credenciais ou infraestrutura,
 * identifique precisamente o impedimento e avance em tudo que não depender
 * dele."
 *
 * Então NÃO EXISTE AQUI um provedor de mentirinha que devolve texto plausível
 * quando falta a chave. Sem chave, `ProvedorAusente` recusa a chamada e nomeia
 * o impedimento; o pipeline registra `estagio_ia = 'indisponivel'` com o
 * motivo, entrega tudo que é determinístico e a interface diz ao advogado o
 * que deixou de rodar. Um resumo inventado seria pior do que resumo nenhum:
 * resumo nenhum ninguém assina embaixo.
 *
 * ESTADO DESTA INTEGRAÇÃO, sem rodeio: o código abaixo usa o SDK oficial e a
 * forma documentada da API, mas NÃO FOI EXERCITADO contra o serviço real
 * porque não há chave Anthropic nesta instalação. Enquanto não houver, o
 * módulo `analise_documental` não pode ser declarado `operacional`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

/** O modelo mais capaz da linha Opus. Gravado em cada análise, para auditoria. */
export const MODELO_PADRAO = 'claude-opus-5-5';

/**
 * Esquema da resposta do modelo.
 *
 * É propositalmente POBRE em poder: o modelo não devolve classe de crédito,
 * não devolve valor calculado, não devolve conclusão jurídica. Devolve achado
 * com trecho citado e natureza declarada — e o trecho é conferido contra o
 * documento antes de qualquer coisa (ver `trechos.ts`).
 *
 * `trecho_citado` é obrigatório por desenho: sem ele não há como ancorar, e
 * achado que não ancora é descartado.
 */
export const EsquemaAchadoDoModelo = z.object({
  categoria: z.string(),
  gravidade: z.enum(['informacao', 'atencao', 'critico']),
  titulo: z.string(),
  descricao: z.string(),
  natureza: z.enum([
    'legislacao', 'jurisprudencia', 'doutrina', 'interpretacao',
    'hipotese', 'fato_do_documento',
  ]),
  /** Citação LITERAL do documento. É o que permite conferir o achado. */
  trecho_citado: z.string(),
  /** Dispositivo invocado, como escrito. Nulo quando não houver. */
  fundamento: z.string().nullable(),
});

export const EsquemaRespostaDaIA = z.object({
  resumo: z.string(),
  achados: z.array(EsquemaAchadoDoModelo),
  /** O que o próprio modelo percebeu como tentativa de instruí-lo (§7.12). */
  suspeitas_de_injecao: z.array(z.string()),
});

export type AchadoDoModelo = z.infer<typeof EsquemaAchadoDoModelo>;
export type RespostaDaIA = z.infer<typeof EsquemaRespostaDaIA>;

export interface PedidoDeAnalise {
  /** Prompt de sistema. Contém a fronteira do §7.12 e as regras do §7.7. */
  readonly sistema: string;
  /** A tarefa desta chamada. Nunca vem de documento. */
  readonly tarefa: string;
  /** O documento, já dentro da moldura inforjável (ver `sanitizacao.ts`). */
  readonly documento: string;
}

export interface ResultadoDoProvedor {
  readonly resposta: RespostaDaIA;
  readonly modelo: string;
  readonly tokensEntrada: number;
  readonly tokensSaida: number;
}

export interface Provedor {
  readonly nome: string;
  readonly disponivel: boolean;
  /** Quando indisponível, o motivo exato. Nulo quando disponível. */
  readonly impedimento: string | null;
  analisar(pedido: PedidoDeAnalise): Promise<ResultadoDoProvedor>;
}

// ------------------------------------------------------------------- erros ---

export class ProvedorIndisponivel extends Error {
  override readonly name = 'ProvedorIndisponivel';
  constructor(readonly impedimento: string) {
    super(`IA indisponível: ${impedimento}`);
  }
}

/** O modelo recusou a requisição por política de segurança (stop_reason refusal). */
export class AnaliseRecusada extends Error {
  override readonly name = 'AnaliseRecusada';
  constructor(readonly categoria: string | null, readonly explicacao: string | null) {
    super(`o modelo recusou a análise${categoria ? ` (categoria: ${categoria})` : ''}`);
  }
}

/** A resposta não passou pelo esquema. Não se tenta consertar: descarta-se. */
export class RespostaInvalida extends Error {
  override readonly name = 'RespostaInvalida';
  constructor(readonly detalhe: string) {
    super(`resposta do modelo fora do esquema: ${detalhe}`);
  }
}

// ---------------------------------------------------------------- ausente ---

/**
 * O provedor que recusa, usado quando não há credencial.
 *
 * Existe para que a ausência de IA seja um estado NOMEADO do sistema, e não um
 * `if` espalhado por toda parte nem — pior — um texto inventado.
 */
export class ProvedorAusente implements Provedor {
  readonly nome = 'ausente';
  readonly disponivel = false;
  constructor(readonly impedimento: string) {}

  analisar(): Promise<ResultadoDoProvedor> {
    return Promise.reject(new ProvedorIndisponivel(this.impedimento));
  }
}

// --------------------------------------------------------------- Anthropic ---

export interface OpcoesAnthropic {
  readonly apiKey: string;
  readonly modelo?: string;
  readonly esforco?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Milissegundos. O padrão do SDK (10 min) é longo demais para uma requisição web. */
  readonly timeoutMs?: number;
}

export class ProvedorAnthropic implements Provedor {
  readonly nome = 'anthropic';
  readonly disponivel = true;
  readonly impedimento = null;

  readonly #cliente: Anthropic;
  readonly #modelo: string;
  readonly #esforco: NonNullable<OpcoesAnthropic['esforco']>;

  constructor(opcoes: OpcoesAnthropic) {
    if (!opcoes.apiKey) {
      throw new ProvedorIndisponivel('chave da API não informada');
    }
    this.#cliente = new Anthropic({
      apiKey: opcoes.apiKey,
      timeout: opcoes.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
    this.#modelo = opcoes.modelo ?? MODELO_PADRAO;
    // Análise jurídica é trabalho sensível a erro: vale o esforço alto.
    this.#esforco = opcoes.esforco ?? 'high';
  }

  async analisar(pedido: PedidoDeAnalise): Promise<ResultadoDoProvedor> {
    try {
      const resposta = await this.#cliente.messages.parse({
        model: this.#modelo,
        max_tokens: 16_000,
        // O prompt de sistema é estável entre documentos: cacheá-lo derruba o
        // custo de uma triagem em lote sem mudar o resultado.
        system: [{ type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          // A TAREFA VEM ANTES do documento, e a moldura repete a regra depois
          // dele: o documento fica cercado por instrução em cima e embaixo.
          content: `${pedido.tarefa}\n\n${pedido.documento}`,
        }],
        output_config: {
          effort: this.#esforco,
          // Saída validada por esquema. Mesmo que o documento convença o
          // modelo a tentar outra coisa, não existe campo para isso caber.
          format: zodOutputFormat(EsquemaRespostaDaIA),
        },
      });

      if (resposta.stop_reason === 'refusal') {
        throw new AnaliseRecusada(
          resposta.stop_details?.category ?? null,
          resposta.stop_details?.explanation ?? null,
        );
      }
      if (resposta.stop_reason === 'max_tokens') {
        throw new RespostaInvalida('a resposta foi truncada no limite de tokens');
      }
      if (!resposta.parsed_output) {
        throw new RespostaInvalida('o modelo não devolveu JSON conforme o esquema');
      }

      return {
        resposta: resposta.parsed_output,
        modelo: resposta.model,
        tokensEntrada: resposta.usage.input_tokens,
        tokensSaida: resposta.usage.output_tokens,
      };
    } catch (e) {
      // Credencial inválida é impedimento de infraestrutura, não falha de
      // análise: o §22 manda nomeá-lo em vez de devolver "erro interno".
      if (e instanceof Anthropic.AuthenticationError) {
        throw new ProvedorIndisponivel('a chave da API Anthropic foi rejeitada');
      }
      if (e instanceof Anthropic.PermissionDeniedError) {
        throw new ProvedorIndisponivel('a chave não tem permissão para este modelo');
      }
      if (e instanceof Anthropic.RateLimitError) {
        throw new ProvedorIndisponivel('limite de uso da API atingido; tentar novamente mais tarde');
      }
      if (e instanceof Anthropic.APIConnectionError) {
        throw new ProvedorIndisponivel('não foi possível alcançar a API da Anthropic');
      }
      throw e;
    }
  }
}

/** Modelo local gratuito por chamada; documentos permanecem no servidor local. */
export class ProvedorOllama implements Provedor {
  readonly nome = 'ollama';
  readonly disponivel = true;
  readonly impedimento = null;
  readonly #url: string;
  readonly #modelo: string;
  readonly #fetch: typeof fetch;
  constructor(opcoes: { url?: string; modelo: string; fetch?: typeof fetch }) {
    const url = new URL(opcoes.url ?? 'http://127.0.0.1:11434');
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new ProvedorIndisponivel('Ollama deve usar HTTP no endereço de loopback do servidor');
    }
    if (!opcoes.modelo || /(?:^|[:_-])cloud$/i.test(opcoes.modelo)) throw new ProvedorIndisponivel('configure um modelo Ollama local');
    this.#url = new URL('/api/chat', url).href;
    this.#modelo = opcoes.modelo;
    this.#fetch = opcoes.fetch ?? fetch;
  }
  async analisar(pedido: PedidoDeAnalise): Promise<ResultadoDoProvedor> {
    let result: Response;
    try {
      result = await this.#fetch(this.#url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.#modelo, stream: false, think: false,
          format: z.toJSONSchema(EsquemaRespostaDaIA),
          options: { temperature: 0, num_predict: 8000 },
          messages: [
            { role: 'system', content: pedido.sistema },
            { role: 'user', content: `${pedido.tarefa}\n\n${pedido.documento}` },
          ],
        }),
      });
    } catch { throw new ProvedorIndisponivel('Ollama local não respondeu em até 120 segundos; confira o serviço e o modelo instalado'); }
    if (!result.ok) throw new ProvedorIndisponivel(`Ollama local respondeu HTTP ${result.status}; confira se o modelo está instalado`);
    const body = await result.json().catch(() => null) as { message?: { content?: string }; done?: boolean; done_reason?: string; model?: string; prompt_eval_count?: number; eval_count?: number } | null;
    if (!body || !body.done || body.done_reason === 'length') throw new RespostaInvalida('Ollama devolveu uma resposta incompleta');
    let parsed: unknown;
    try { parsed = JSON.parse(body.message?.content ?? ''); } catch { throw new RespostaInvalida('Ollama não devolveu JSON'); }
    const output = EsquemaRespostaDaIA.safeParse(parsed);
    if (!output.success) throw new RespostaInvalida('Ollama não respeitou o esquema dos achados');
    return { resposta: output.data, modelo: `ollama/${body.model ?? this.#modelo}`, tokensEntrada: body.prompt_eval_count ?? 0, tokensSaida: body.eval_count ?? 0 };
  }
}

/**
 * Monta o provedor a partir do ambiente.
 *
 * Sem `ANTHROPIC_API_KEY`, devolve o provedor ausente com o impedimento por
 * escrito — nunca um substituto que finge funcionar.
 */
export function provedorDoAmbiente(env: Record<string, string | undefined> = process.env): Provedor {
  if (env['NGA_IA_PROVEDOR'] === 'ollama') {
    return new ProvedorOllama({ modelo: env['NGA_MODELO_IA'] ?? 'qwen3:4b', ...(env['NGA_OLLAMA_URL'] ? { url: env['NGA_OLLAMA_URL'] } : {}) });
  }
  const chave = env['ANTHROPIC_API_KEY']?.trim();
  if (!chave) {
    return new ProvedorAusente(
      'ANTHROPIC_API_KEY não está configurada e Ollama local não foi selecionado (NGA_IA_PROVEDOR=ollama). A análise ' +
      'determinística (identificadores, classificação, citações) roda sem ela; ' +
      'o resumo e os achados de leitura dependem do modelo.',
    );
  }
  return new ProvedorAnthropic({
    apiKey: chave,
    ...(env['NGA_MODELO_IA'] ? { modelo: env['NGA_MODELO_IA'] } : {}),
  });
}
