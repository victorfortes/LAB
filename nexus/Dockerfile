# Imagem do Nexus. Multi-estágio para não levar o cache de dependências junto.
FROM oven/bun:1.4 AS dependencias
WORKDIR /app
COPY package.json bun.lock ./
# --production deixa de fora o que só serve a teste (PostgreSQL embutido, tipos).
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4
WORKDIR /app

COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY web ./web
COPY ui ./ui
COPY scripts ./scripts

# O acervo guarda documento de cliente e fica FORA de web/: se o servidor de
# estáticos o alcançasse, a URL assinada não protegeria nada (§12.4).
RUN mkdir -p /app/acervo && chown -R bun:bun /app/acervo
VOLUME ["/app/acervo"]

USER bun
ENV NGA_HOST=0.0.0.0 NGA_PORTA=8790 NGA_ACERVO=/app/acervo
EXPOSE 8790

# Sobe direto o servidor. As migrações são passo separado e deliberado
# (`bun run migrate`): aplicar schema no arranque de cada réplica é como duas
# instâncias migram o mesmo banco ao mesmo tempo.
CMD ["bun", "src/server/main.ts"]
