# Como o mercado monitora processos e o que falta ao Sentinela (pesquisa de 02/11/2026)

## O que apurei sobre o JusBrasil e concorrentes
- O JusBrasil **não documenta publicamente** como obtém os dados. O acompanhamento de "novos processos por documento" que ele
  vende ao consumidor é **por CPF** (o próprio), não por CNPJ de terceiros. Para empresas, o mercado usa serviços como Judit e Escavador (pagos, por API).
- Segundo material desses fornecedores (afirmações comerciais, não verificadas por mim), a arquitetura é em camadas:
  1. **Sistemas de tramitação dos tribunais** (PJe, eproc, e-SAJ, Projudi…) com acesso autenticado: é onde a distribuição nasce e onde se veem processos sob sigilo conforme o perfil.
  2. **DJEN / Diários Oficiais**: camada de publicações, completa para prazos mas *não* para todos os eventos. Um processo pode existir antes de gerar publicação.
  3. **Consulta pública** (sem login): limitada por sigilo e CAPTCHA; serve para conferência.
  4. **DataJud**: metadados, não é monitoramento em tempo real.
- Conclusão do próprio mercado: **nenhuma fonte pública isolada cobre tudo**; quem promete cobertura alta usa acesso autenticado aos tribunais.

## O que o Sentinela já faz (só fontes públicas gratuitas)
DJEN (por nome de parte, nome no corpo do texto, CNPJ no texto, **iniciais** quando o tribunal abrevia a parte) + DataJud (data de ajuizamento),
com prova diária de leitura, preenchimento de lacunas, releitura de 7 dias e teste de captura. Medido na Trans Mosa (75 processos do Astrea):
visibilidade de ~53% → ver relatório da tela *Garantia de cobertura*.

## O canal oficial que fecha a lacuna: Domicílio Judicial Eletrônico (DJE)
- Res. CNJ 455/2022 (art. 246 do CPC): **empresas são obrigadas a se cadastrar** e a **citação** (o ato que informa uma ação nova) é feita pelo DJE.
  Cobre também processos que não geram publicação visível no DJEN.
- O escritório pode ser cadastrado pela empresa como **preposto/procurador** para ver as comunicações.
- O CNJ descreve uma **API** do DJE para integrar sistemas de gestão (há módulo de solicitação de acesso às APIs).
- **Não encontrei** a documentação técnica pública da API (endpoints, autenticação). O caminho é pedir acesso e o manual de integração ao CNJ.

### O que o escritório precisa providenciar (eu não consigo fazer isso por vocês)
1. Confirmar que cada cliente tem o CNPJ cadastrado no DJE e que o escritório consta como preposto/procurador.
2. Solicitar ao CNJ, pelo portal do DJE, o acesso às APIs de integração e obter o manual (pode exigir certificado digital e autorização do cliente).
3. Com as credenciais e o manual em mãos, o Sentinela ganha um conector `dje` como segunda fonte (a arquitetura já prevê fontes plugáveis e a prova de cobertura).

Até lá, o Sentinela deve ser apresentado como: *leitura completa e provada do DJEN + DataJud, com percentual medido de visibilidade*,
e não como cobertura total.

## Alternativa paga (se o DJE demorar)
APIs comerciais (Judit, Escavador) com acesso autenticado aos tribunais. Exigem contrato, custo por CNPJ monitorado e validação de cobertura
com os mesmos processos-controle antes de confiar.
