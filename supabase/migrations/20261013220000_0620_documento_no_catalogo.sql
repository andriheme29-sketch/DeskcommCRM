-- manifest: o agente ENTREGA o material que o funil promete (o guia alimentar da
-- Etapa 8) por `documento_codigo` no `send_message` — `catalog_media` passa a
-- aceitar `tipo='documento'` e o bucket privado `catalog-docs` guarda os PDFs.
-- ============================================================================
-- 0620 — O AGENTE MANDA DOCUMENTO (o guia alimentar) por CÓDIGO de material
--
-- O funil da Fignar promete um material ao cliente e MANDA entregá-lo na Etapa 8
-- ("Certo, seu guia alimentar já está pronto!"). Até aqui o CRM não tinha por
-- onde: o agente PROMETIA e não cumpria. Medido numa conversa real: o lead
-- ficou com as tags `guia-pronto-aguardando-valores` e
-- `guia-alimentar-pendente-coleta` e guia nenhum. Prometer e não entregar é o
-- que mais queima a confiança de quem já está quase comprando.
--
-- ─── Por que reusar `catalog_media` em vez de tabela nova
--
-- A tabela já é "papel → arquivo" da marca (0613), com a leitura que confere
-- `<organização>/` no caminho e a cópia para a pasta da conversa. Um documento é
-- o MESMO caso de uso com outro mime: criar uma tabela irmã duplicaria a regra
-- inteira (inclusive a conferência de organização, que é o que impede ler
-- material alheio). O que muda é só o conjunto de `tipo` aceito.
--
-- ─── Por que bucket próprio, privado (`catalog-docs`)
--
-- Molde de `catalog-video`: a limpeza de LGPD apaga a mídia das CONVERSAS de um
-- contato, e o material de marca não é de contato nenhum. Quando o agente manda,
-- o app COPIA o arquivo para a pasta da conversa em `whatsapp-media` — é a cópia
-- que a conversa possui e que a LGPD apaga.
--
-- 50 MB e `application/pdf`: é o que o WhatsApp entrega como documento sem
-- conversão. Nenhuma policy em `storage.objects`: só o `service_role` lê e grava,
-- depois de a rota conferir o papel.
--
-- Idempotente: `alter table ... drop constraint` + `add constraint`, bucket com
-- `on conflict do update`. Aditiva: nada existente muda.
-- ============================================================================

-- 1) `catalog_media` passa a aceitar documento além de vídeo.
alter table public.catalog_media
  drop constraint if exists catalog_media_tipo_valido;
alter table public.catalog_media
  add constraint catalog_media_tipo_valido check (tipo in ('video', 'documento'));

-- 2) O bucket privado dos materiais.
insert into storage.buckets (id, name, public, file_size_limit)
values ('catalog-docs', 'catalog-docs', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;