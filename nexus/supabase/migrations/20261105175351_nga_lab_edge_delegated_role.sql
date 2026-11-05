-- Infraestrutura do Edge assume o papel restrito em toda transação.
-- Não herdar privilégios nem alterar acesso público.
GRANT nga_app TO postgres WITH SET TRUE, INHERIT FALSE;
