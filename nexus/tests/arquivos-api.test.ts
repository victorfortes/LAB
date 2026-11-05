import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bancoDeTeste, type BancoDeTeste } from './apoio/postgres.ts';
import { Banco } from '../src/store/conexao.ts';
import { criarApp } from '../src/server/app.ts';
import { hashDaSenha } from '../src/security/sessao.ts';
import { ArmazenamentoLocal, hashDoConteudo } from '../src/store/arquivos.ts';
import { deposito as montarDeposito, type Deposito } from '../src/server/arquivos.ts';
import { docxDeTeste, pdfDeTeste, pngDeTeste } from './apoio/zip.ts';

let pg: BancoDeTeste; let banco: Banco; let raiz: string;
let dep: Deposito; let armazenamento: ArmazenamentoLocal;
let tratar: (req: Request) => Promise<Response>;

const NGA = '11111111-1111-1111-1111-111111111111';
const CLIENTE = '22222222-2222-2222-2222-222222222222';
const OUTRO = '33333333-3333-3333-3333-333333333333';
const ADVOGADO = 'aaaaaaaa-0000-0000-0000-000000000001';
const CLIENTE_USR = 'aaaaaaaa-0000-0000-0000-000000000002';
const OUTRO_USR = 'aaaaaaaa-0000-0000-0000-000000000003';
const SENHA = 'uma-senha-bem-longa';
const SEGREDO = 'segredo-de-teste-de-arquivos-com-mais-de-32';
let projeto: string, portalId: string, requisito: string, requisitoDoCliente: string;

beforeAll(async () => {
  pg = await bancoDeTeste();
  const db = pg.dono;
  await db.query(`ALTER ROLE nga_app PASSWORD 'nga_app'`);
  banco = new Banco({ host: 'localhost', port: pg.porta, user: 'nga_app', password: 'nga_app', database: 'nga_teste' });

  raiz = await mkdtemp(join(tmpdir(), 'nga-acervo-'));
  armazenamento = new ArmazenamentoLocal(raiz);
  await armazenamento.iniciar();
  dep = montarDeposito(armazenamento, { NGA_SEGREDO_ARQUIVOS: SEGREDO });
  tratar = criarApp({ banco, deposito: dep });

  const h = await hashDaSenha(SENHA);
  await db.query(`INSERT INTO organizacoes (id,tipo,nome) VALUES ($1,'escritorio','NGA'),($2,'cliente','Grupo X'),($3,'cliente','Grupo Y')`, [NGA, CLIENTE, OUTRO]);
  await db.query(`INSERT INTO usuarios (id,email,nome,senha_hash) VALUES
    ($1,'adv@nga.adv.br','Advogado',$4),($2,'dir@grupox.com','Diretor X',$4),
    ($3,'dir@grupoy.com','Diretor Y',$4)`, [ADVOGADO, CLIENTE_USR, OUTRO_USR, h]);
  await db.query(`INSERT INTO vinculos (usuario_id,organizacao_id,papel) VALUES
    ($1,$4,'advogado'),($2,$5,'cliente_administrador'),($3,$6,'cliente_administrador')`,
    [ADVOGADO, CLIENTE_USR, OUTRO_USR, NGA, CLIENTE, OUTRO]);

  projeto = (await db.query<{id:string}>(`INSERT INTO projetos (organizacao_id,nome,tipo)
    VALUES ($1,'RJ Grupo X','recuperacao_judicial') RETURNING id`, [NGA])).rows[0]!.id;
  portalId = (await db.query<{id:string}>(`INSERT INTO portais (projeto_id,organizacao_cliente_id)
    VALUES ($1,$2) RETURNING id`, [projeto, CLIENTE])).rows[0]!.id;
  requisito = (await db.query<{id:string}>(`INSERT INTO requisitos
    (organizacao_id,projeto_id,categoria,titulo) VALUES ($1,$2,'Societário','Contrato social')
    RETURNING id`, [NGA, projeto])).rows[0]!.id;
  requisitoDoCliente = (await db.query<{id:string}>(`INSERT INTO requisitos
    (organizacao_id,projeto_id,categoria,titulo) VALUES ($1,$2,'Contábil','Balanço patrimonial')
    RETURNING id`, [NGA, projeto])).rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await banco?.encerrar(); await pg?.encerrar();
  await rm(raiz, { recursive: true, force: true });
});

async function entrar(email: string): Promise<string> {
  const r = await tratar(new Request('http://x/api/sessao', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha: SENHA }) }));
  expect(r.status).toBe(200);
  return /nga_sessao=([^;]+)/.exec(r.headers.get('set-cookie')!)![1]!;
}
const req = (t: string, url: string, init: RequestInit = {}) =>
  tratar(new Request(`http://x${url}`, { ...init,
    headers: { cookie: `nga_sessao=${t}`, ...(init.headers ?? {}) } }));
const jsonReq = (t: string, url: string, init: RequestInit = {}) =>
  req(t, url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

/** Comparação de bytes sem brigar com a variância de Uint8Array no TS. */
const mesmosBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

function formulario(conteudo: Uint8Array, nome: string, tipo: string, extras: Record<string, string> = {}) {
  const f = new FormData();
  f.append('arquivo', new File([conteudo as unknown as BlobPart], nome, { type: tipo }));
  for (const [k, v] of Object.entries(extras)) f.append(k, v);
  return f;
}

let documentoNga: string, documentoCliente: string;

describe('envio de arquivo', () => {
  test('a NGA envia um PDF e o acervo guarda os bytes exatos', async () => {
    const t = await entrar('adv@nga.adv.br');
    const pdf = pdfDeTeste();
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(pdf, 'petição inicial.pdf', 'application/pdf',
        { titulo: 'Petição inicial', categoria: 'Petição' }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    documentoNga = corpo.documentoId;

    expect(corpo.temArquivo).toBe(true);
    expect(corpo.hash).toBe(hashDoConteudo(pdf));
    expect(corpo.tipo).toBe('application/pdf');
    expect(corpo.nome).toBe('petição inicial.pdf');
    expect(corpo.tamanho).toBe(pdf.byteLength);
  });

  test('o tipo é reconhecido pelos bytes, não pelo que o navegador declarou', async () => {
    // HTML renomeado para .pdf com Content-Type mentindo: o acervo não cai.
    const t = await entrar('adv@nga.adv.br');
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(html, 'inocente.pdf', 'application/pdf',
        { titulo: 'Disfarçado' }) });
    expect(r.status).toBe(201);
    expect((await r.json()).tipo).toStartWith('text/plain');
  });

  test('executável é recusado com 415', async () => {
    const t = await entrar('adv@nga.adv.br');
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0, 0, 0]);
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(elf, 'certidao.pdf', 'application/pdf',
        { titulo: 'Malicioso' }) });
    expect(r.status).toBe(415);
    expect((await r.json()).erro).toContain('não aceito');
  });

  test('conteúdo repetido é deduplicado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(pdfDeTeste(), 'copia.pdf', 'application/pdf',
        { titulo: 'Mesma petição, outro documento' }) });
    expect((await r.json()).deduplicado).toBe(true);
  });

  test('docx é aceito e identificado pelo contêiner', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(docxDeTeste(), 'minuta.docx',
        'application/octet-stream', { titulo: 'Minuta' }) });
    expect((await r.json()).rotuloDoTipo).toBe('Documento Word');
  });

  test('o registro de referência, sem arquivo, continua possível e se declara', async () => {
    // Documento que só existe em papel, no arquivo físico: a linha é criada e
    // a resposta diz `temArquivo: false`, para a interface não oferecer um
    // download que não existe (§18).
    const t = await entrar('adv@nga.adv.br');
    const r = await jsonReq(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST',
      body: JSON.stringify({ requisitoId: requisito, titulo: 'Só no arquivo físico', caminho: 'pasta 12' }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.temArquivo).toBe(false);
    expect(corpo.situacao).toBe('enviado');
  });
});

describe('download por URL assinada', () => {
  let link: string;

  test('o link é emitido com prazo curto', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await jsonReq(t, `/api/documentos/${documentoNga}/link`, { method: 'POST' });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    link = corpo.url;
    expect(link).toStartWith('/arquivos/v1.');
    expect(corpo.validadeSegundos).toBeLessThanOrEqual(300);
    expect(corpo.nome).toBe('petição inicial.pdf');
  });

  test('o download funciona SEM cookie e devolve os bytes originais', async () => {
    const r = await tratar(new Request(`http://x${link}`));
    expect(r.status).toBe(200);
    expect(mesmosBytes(new Uint8Array(await r.arrayBuffer()), pdfDeTeste())).toBe(true);
  });

  test('a resposta força download e proíbe interpretação pelo navegador', async () => {
    const r = await tratar(new Request(`http://x${link}`));
    expect(r.headers.get('content-disposition')).toStartWith('attachment;');
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('cache-control')).toContain('no-store');
    // O nome com acento vai nas duas formas, como manda a RFC 5987.
    expect(r.headers.get('content-disposition')).toContain("filename*=UTF-8''");
  });

  test('link adulterado é 403', async () => {
    const forjado = link.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await tratar(new Request(`http://x${forjado}`))).status).toBe(403);
  });

  test('link vencido é 410 — resposta diferente da de link forjado', async () => {
    // 410 diz ao usuário legítimo que basta pedir outro link; 403 não confirma
    // nada a quem está tentando adivinhar assinatura.
    const curto = criarApp({
      banco,
      deposito: montarDeposito(armazenamento,
        { NGA_SEGREDO_ARQUIVOS: SEGREDO, NGA_VALIDADE_LINK: '1' }),
    });
    const t = await entrar('adv@nga.adv.br');
    const r = await curto(new Request(`http://x/api/documentos/${documentoNga}/link`, {
      method: 'POST', headers: { cookie: `nga_sessao=${t}`, 'content-type': 'application/json' },
    }));
    const url: string = (await r.json()).url;

    expect((await curto(new Request(`http://x${url}`))).status).toBe(200);
    await Bun.sleep(1100);
    const vencido = await curto(new Request(`http://x${url}`));
    expect(vencido.status).toBe(410);
    expect((await vencido.json()).erro).toContain('expirou');
  });

  test('o documento sem arquivo não gera link', async () => {
    const t = await entrar('adv@nga.adv.br');
    const semArquivo = (await pg.dono.query<{id:string}>(
      `INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho)
       VALUES ($1,$2,'Referência','pasta 12') RETURNING id`, [NGA, projeto])).rows[0]!.id;
    const r = await jsonReq(t, `/api/documentos/${semArquivo}/link`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('não há arquivo guardado');
  });
});

describe('§13 — o acervo respeita o isolamento', () => {
  test('o cliente envia pelo portal e o documento nasce interno', async () => {
    const t = await entrar('dir@grupox.com');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST',
      body: formulario(pngDeTeste(), 'contrato social.png', 'image/png',
        { titulo: 'Balanço patrimonial', requisitoId: requisitoDoCliente }),
    });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    documentoCliente = corpo.documentoId;
    expect(corpo.situacao).toBe('enviado');

    const { rows } = await pg.dono.query<{ visibilidade: string; origem: string }>(
      'SELECT visibilidade, origem FROM documentos WHERE id = $1', [documentoCliente]);
    expect(rows[0]!.visibilidade).toBe('interno');
    expect(rows[0]!.origem).toBe('portal_cliente');
  });

  test('o cliente NÃO consegue link do que ele mesmo enviou, porque é interno', async () => {
    // Não é defeito: é a garantia valendo até para a linha que ele criou.
    const t = await entrar('dir@grupox.com');
    const r = await jsonReq(t, `/api/documentos/${documentoCliente}/link`, { method: 'POST' });
    expect(r.status).toBe(404);
  });

  test('a NGA alcança o documento enviado pelo cliente', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await jsonReq(t, `/api/documentos/${documentoCliente}/link`, { method: 'POST' });
    expect(r.status).toBe(200);
    const baixado = await tratar(new Request(`http://x${(await r.json()).url}`));
    expect(mesmosBytes(new Uint8Array(await baixado.arrayBuffer()), pngDeTeste())).toBe(true);
  });

  test('outro cliente não emite link de documento alheio', async () => {
    const t = await entrar('dir@grupoy.com');
    expect((await jsonReq(t, `/api/documentos/${documentoNga}/link`, { method: 'POST' })).status)
      .toBe(404);
  });

  test('link de um usuário não serve a outro', async () => {
    // A concessão carrega o id do usuário; trocá-lo quebra a assinatura, e
    // mesmo que não quebrasse, o RLS do outro não alcançaria o documento.
    const nga = await entrar('adv@nga.adv.br');
    const url: string = (await (await jsonReq(nga, `/api/documentos/${documentoNga}/link`,
      { method: 'POST' })).json()).url;
    const trocado = url.replace(ADVOGADO, OUTRO_USR);
    expect((await tratar(new Request(`http://x${trocado}`))).status).toBe(403);
  });
});

describe('a autorização é refeita a cada download, não congelada no link', () => {
  test('publicar, pegar o link e despublicar mata o link na hora', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const r = await req(nga, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(new TextEncoder().encode('Relatório ao cliente — outubro'),
        'relatorio.txt', 'text/plain', { titulo: 'Relatório de outubro' }) });
    const doc = (await r.json()).documentoId;
    await jsonReq(nga, `/api/documentos/${doc}/publicacao`, { method: 'POST' });

    const cliente = await entrar('dir@grupox.com');
    const link: string = (await (await jsonReq(cliente, `/api/documentos/${doc}/link`,
      { method: 'POST' })).json()).url;
    expect((await tratar(new Request(`http://x${link}`))).status).toBe(200);

    // Despublicar. O link ainda está no prazo — e mesmo assim para de servir.
    await jsonReq(nga, `/api/documentos/${doc}/publicacao`, { method: 'DELETE' });
    expect((await tratar(new Request(`http://x${link}`))).status).toBe(404);
  });

  test('desligar o portal também mata o link no mesmo instante', async () => {
    const nga = await entrar('adv@nga.adv.br');
    const r = await req(nga, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(new TextEncoder().encode('Edital publicado'),
        'edital.txt', 'text/plain', { titulo: 'Edital' }) });
    const doc = (await r.json()).documentoId;
    await jsonReq(nga, `/api/documentos/${doc}/publicacao`, { method: 'POST' });

    const cliente = await entrar('dir@grupox.com');
    const link: string = (await (await jsonReq(cliente, `/api/documentos/${doc}/link`,
      { method: 'POST' })).json()).url;
    expect((await tratar(new Request(`http://x${link}`))).status).toBe(200);

    await pg.dono.query('UPDATE portais SET ativo = FALSE WHERE id = $1', [portalId]);
    expect((await tratar(new Request(`http://x${link}`))).status).toBe(404);
    await pg.dono.query('UPDATE portais SET ativo = TRUE WHERE id = $1', [portalId]);
  });
});

describe('integridade na entrega', () => {
  test('cópia remota preserva o original quando o disco é adulterado', async () => {
    const t = await entrar('adv@nga.adv.br');
    const conteudo = new TextEncoder().encode('laudo pericial original');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(conteudo, 'laudo.txt', 'text/plain', { titulo: 'Laudo' }) });
    const doc = (await r.json()).documentoId;
    const link: string = (await (await jsonReq(t, `/api/documentos/${doc}/link`,
      { method: 'POST' })).json()).url;

    const hash = hashDoConteudo(conteudo);
    await Bun.write(join(raiz, hash.slice(0, 2), hash.slice(2, 4), hash), 'conteúdo trocado');
    const baixado = await tratar(new Request(`http://x${link}`));
    expect(baixado.status).toBe(200);
    expect(new Uint8Array(await baixado.arrayBuffer())).toEqual(conteudo);
    // Mesmo um conteúdo alterado com seu próprio hash deve falhar contra o hash do documento.
    const adulterado = Buffer.from('conteúdo remoto trocado');
    await pg.dono.query('UPDATE documento_conteudos SET conteudo=$1, hash_sha256=$2 WHERE documento_id=$3', [adulterado, hashDoConteudo(adulterado), doc]);
    const recusado = await tratar(new Request(`http://x${link}`));
    expect(recusado.status).toBe(500);
    expect((await recusado.json()).erro).toContain('não confere com o hash registrado');
  });
});

describe('do arquivo guardado para a análise', () => {
  test('texto é extraído do arquivo e vira insumo da triagem', async () => {
    const t = await entrar('adv@nga.adv.br');
    const peca = [
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO',
      'INDÚSTRIA DEMO LTDA., CNPJ 33.000.167/0001-99, vem requerer a recuperação',
      'judicial, nos termos do art. 51 da Lei 11.101/2005.',
    ].join('\n');
    const r = await req(t, `/api/projetos/${projeto}/documentos`, {
      method: 'POST', body: formulario(new TextEncoder().encode(peca),
        'peticao.txt', 'text/plain', { titulo: 'Petição em texto' }) });
    const doc = (await r.json()).documentoId;

    const extraido = await jsonReq(t, `/api/documentos/${doc}/texto/extrair`, { method: 'POST' });
    expect(extraido.status).toBe(201);
    expect((await extraido.json()).caracteres).toBe(peca.length);

    // E a triagem roda em cima do que foi extraído, sem ninguém colar nada.
    const analise = await (await jsonReq(t, `/api/documentos/${doc}/analises`, {
      method: 'POST', body: JSON.stringify({ comIa: false }) })).json();
    expect(analise.tipoSugerido).toBe('peticao_inicial_rj');
    expect(analise.achados.some((a: { titulo: string }) => a.titulo.includes('CNPJ'))).toBe(true);
  });

  test('para PDF, a recusa nomeia o que falta em vez de inventar extração', async () => {
    const t = await entrar('adv@nga.adv.br');
    const r = await jsonReq(t, `/api/documentos/${documentoNga}/texto/extrair`, { method: 'POST' });
    expect(r.status).toBe(400);
    const erro = (await r.json()).erro;
    expect(erro).toContain('Extração de PDF e OCR');
    expect(erro).toContain('cole o texto');
  });

  test('documento sem arquivo não tem o que extrair', async () => {
    const t = await entrar('adv@nga.adv.br');
    const semArquivo = (await pg.dono.query<{id:string}>(
      `INSERT INTO documentos (organizacao_id,projeto_id,titulo,caminho)
       VALUES ($1,$2,'Papel','gaveta 3') RETURNING id`, [NGA, projeto])).rows[0]!.id;
    const r = await jsonReq(t, `/api/documentos/${semArquivo}/texto/extrair`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toContain('não tem arquivo guardado');
  });
});

describe('estado declarado do acervo', () => {
  test('diz os limites, os tipos e o que NÃO foi construído', async () => {
    const t = await entrar('adv@nga.adv.br');
    const e = await (await req(t, '/api/arquivos/estado')).json();
    expect(e.armazenamento).toBe('local');
    expect(e.segredoEfemero).toBe(false);
    expect(e.tiposAceitos.map((x: { extensao: string }) => x.extensao)).toContain('pdf');
    expect(e.naoConstruido.join(' ')).toContain('S3');
    expect(e.naoConstruido.join(' ')).toContain('Antivírus');
  });
});
