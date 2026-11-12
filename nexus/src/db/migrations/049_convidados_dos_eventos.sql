-- 049 — Convidados das reuniões.
--
-- Ao criar um evento num projeto, toda a equipe do projeto é convidada pelo
-- Google (com o link do Meet), mais quem a pessoa acrescentar. A lista fica
-- guardada para reenviar o mesmo convite se a primeira tentativa falhar.
ALTER TABLE google_eventos ADD COLUMN convidados TEXT[] NOT NULL DEFAULT '{}';
