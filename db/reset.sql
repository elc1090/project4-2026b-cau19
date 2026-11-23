-- ATENÇÃO: apaga TODAS as tabelas e dados.
-- Use só quando a estrutura mudar e os dados atuais forem de teste.
-- Depois é só ligar o servidor de novo: ele recria tudo a partir do schema.sql.
drop table if exists ai_interactions, answers, alternatives, questions, users cascade;
