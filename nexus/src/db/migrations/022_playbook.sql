-- 022 — Playbook: tarefas geradas pelo próprio sistema.
--
-- `chave_playbook` identifica o passo do playbook que originou a tarefa. Com o índice único, aplicar o
-- playbook de novo (ou entrar de novo numa fase) NUNCA duplica tarefa: o que já existe é pulado, e a
-- tarefa que a equipe apagou ou concluiu não volta sozinha de forma silenciosa — fica contada como "já existia".

ALTER TABLE tarefas ADD COLUMN chave_playbook TEXT;
CREATE UNIQUE INDEX tarefas_playbook_unico ON tarefas (projeto_id, chave_playbook) WHERE chave_playbook IS NOT NULL;

ALTER TABLE tarefas DROP CONSTRAINT tarefas_origem_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_origem_check
  CHECK (origem IN ('manual', 'prazo', 'requisito', 'achado', 'credito', 'playbook'));
