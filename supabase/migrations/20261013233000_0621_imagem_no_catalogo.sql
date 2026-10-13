-- ============================================================================
-- 0621 — A IMAGEM DE MARCA NO CATÁLOGO (o que o funil oficial manda mandar)
--
-- O roteiro do Dr. Carlos manda mídias que NÃO são produto e NÃO são vídeo/PDF:
-- a tabela de composição nutricional (Etapa 6), as imagens de língua e caixinha
-- (Etapas 4/5 do funil oficial) e as tabelas de preço (Etapa 10). Até aqui essas
-- mídias não tinham onde morar, e o roteiro improvisou: a Etapa 6 pedia
-- `[FOTO: fignar-5]` chamando de "foto da composição" — e `fignar-5` é o produto
-- de 5 FRASCOS, com DUAS fotos. MEDIDO em produção: o agente dizia "olha a
-- composição do nosso tratamento" e mandava duas fotos de frascos.
--
-- A fonte de verdade é o funil oficial do fabricante (`FUNIL-OFICIAL.json`), que
-- traz as 7 mídias de marca embutidas com nome e legenda:
--
--   Depoimentos Certo (vídeo)   Imagem Língua      Imagem Caixinha
--   Imagem FigHálito            Video Willian      Preços 1 / Preços 2
--
-- ─── Por que `catalog_media` (e não reusar foto de produto)
--
-- A 0613 já estabeleceu a forma certa: "papel → arquivo" da marca, com leitura
-- que confere `<organização>/` no caminho e cópia para a pasta da conversa. Uma
-- imagem de marca NÃO pertence a produto nenhum — é do funil. Amarrá-la a um
-- produto (como o roteiro fez com `fignar-5`) é exatamente o defeito que esta
-- migração corrige: o arquivo passa a ser do PAPEL, e o papel tem UM arquivo.
--
-- ─── Por que bucket próprio (`catalog-images`), privado
--
-- Molde de `catalog-video`/`catalog-docs`: a limpeza de LGPD apaga a mídia das
-- CONVERSAS de um contato, e o material de marca não é de contato nenhum. No
-- envio o app COPIA para a pasta da conversa em `whatsapp-media` — é a cópia que
-- a conversa possui e que a LGPD apaga.
--
-- 25 MB: as imagens do funil oficial medem de 41 KB a 1,4 MB (a maior é a
-- `Precos 1.png`, 1,45 MB); o teto dá folga para as próximas sem chegar perto
-- do limite de imagem do WhatsApp.
--
-- Idempotente: `alter table ... drop constraint` + `add constraint`, bucket com
-- `on conflict do update`. Aditiva: nada existente muda.
-- ============================================================================

-- 1) `catalog_media` passa a aceitar imagem além de vídeo e documento.
alter table public.catalog_media
  drop constraint if exists catalog_media_tipo_valido;
alter table public.catalog_media
  add constraint catalog_media_tipo_valido check (tipo in ('video', 'documento', 'imagem'));

-- 2) O bucket privado das imagens de marca.
insert into storage.buckets (id, name, public, file_size_limit)
values ('catalog-images', 'catalog-images', false, 26214400)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;