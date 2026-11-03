-- 012 — Vínculo entre o documento e o arquivo guardado.
--
-- POR QUE UMA COLUNA NOVA, E NÃO SÓ O `caminho` QUE JÁ EXISTIA
--
-- Até aqui, `documentos.caminho` era uma referência combinada entre pessoas:
-- alguém escrevia "/acervo/peticao.pdf" e o sistema acreditava. Isso serviu
-- enquanto não havia armazenamento, mas agora convivem dois tipos de linha —
-- a que tem arquivo de verdade atrás e a que é só registro — e confundir as
-- duas significa oferecer download de algo que não existe. O §18 proíbe
-- exatamente isso ("botões sem funcionamento", "links quebrados").
--
-- `tem_arquivo` é essa distinção, e o CHECK garante que ela não minta: dizer
-- que há arquivo obriga a ter hash, tamanho, tipo e data de guarda. O hash é
-- o que liga a linha ao conteúdo endereçado em `src/store/arquivos.ts`, e é
-- conferido em toda leitura.

ALTER TABLE documentos
  ADD COLUMN tem_arquivo   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN armazenado_em TIMESTAMPTZ,
  -- Nome original como o usuário enviou. Serve para o `Content-Disposition`
  -- do download; NUNCA entra no caminho em disco, que é derivado do hash.
  ADD COLUMN nome_original TEXT;

ALTER TABLE documentos
  ADD CONSTRAINT arquivo_completo CHECK (
    NOT tem_arquivo
    OR (hash_sha256 IS NOT NULL
        AND tamanho_bytes IS NOT NULL
        AND tipo_mime IS NOT NULL
        AND armazenado_em IS NOT NULL)
  );

-- Vários documentos podem apontar para o mesmo conteúdo (a mesma certidão
-- enviada por credores diferentes). O índice é o que permite responder, antes
-- de apagar um blob, se ainda há alguém usando aquele conteúdo.
CREATE INDEX idx_documentos_hash ON documentos(hash_sha256) WHERE tem_arquivo;
