-- manifest: o agente manda VÍDEO de marca (depoimento, logística) por `video_codigo`
-- no `send_message` — nova tabela `catalog_media` (papel→arquivo, bucket privado
-- `catalog-video`) que o turno resolve e COPIA para a conversa, como a foto do
-- catálogo; o caminho de envio (`kind:'video'` → `sendVideo`) já existia, faltava
-- expô-lo ao agente.
-- ============================================================================
-- 0613 — O AGENTE MANDA VÍDEO (depoimento / logística) por CÓDIGO de marca
--
-- O funil da Fignar manda DOIS vídeos em etapas próprias: o depoimento
-- (Etapa 4, prova social) e o vídeo da logística/entrega (Etapa 9). Hoje o
-- `send_message` só anexa TEXTO, FOTO (`produto_codigo`) e VOZ
-- (`enviar_como_audio`); o caminho de vídeo JÁ existe de ponta a ponta
-- (`send-message.ts` traduz `kind:'video'` → `sendVideo` do WAHA), faltava
-- expô-lo ao agente.
--
-- ─── Por que uma tabela de marca, e não `catalog_products.videos`
--
-- Depoimento e logística NÃO são atributos de um produto: são mídias da MARCA,
-- presas a uma ETAPA do funil (prova social / entrega). Amarrá-las a um
-- `produto_codigo` obrigaria a inventar um produto para cada vídeo, e o funil
-- referencia por PAPEL ("o depoimento", "o vídeo da entrega"), não por SKU. Aqui
-- o `codigo` é esse papel — estável entre deploys, é ele que o prompt usa
-- (`video_codigo`), nunca o nome do arquivo. Trocar o arquivo é subir outro e
-- reapontar a linha: o prompt não muda.
--
-- ─── Por que bucket próprio, privado (`catalog-video`)
--
-- Mesmo molde de `catalog-photos` (0390): a limpeza de LGPD apaga a mídia das
-- CONVERSAS de um contato, e a mídia de marca não é de contato nenhum. Quando o
-- agente manda, o app COPIA o arquivo para a pasta da conversa em
-- `whatsapp-media` — é a cópia que a conversa possui e que a LGPD apaga.
--
-- 50 MB e só `video/mp4`: é o que o WAHA/WhatsApp entrega sem conversão
-- problemática (o plano de envio pede `convert:true`, mas o mp4 é o formato de
-- origem que não depende disso). Nenhuma policy em `storage.objects`: só o
-- `service_role` lê e grava, depois de a rota conferir o papel.
--
-- Quem LÊ o caminho confere que ele começa com `<organização>/` — um `manager`
-- grava a linha pelo PostgREST e poderia apontar para objeto de outra org; a
-- leitura é por service role, que não tem RLS para barrar (molde de 0390).
--
-- Idempotente: `create table if not exists`, policies recriadas, bucket com
-- `on conflict do update`. Aditiva: nada existente muda.
-- ============================================================================

create table if not exists public.catalog_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null,
  tipo text not null default 'video',
  nome text,
  storage_path text not null,
  mime text not null default 'video/mp4',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_media_tipo_valido check (tipo in ('video')),
  constraint catalog_media_codigo_forma check (codigo ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

create unique index if not exists catalog_media_org_codigo_key
  on public.catalog_media (organization_id, codigo);

alter table public.catalog_media enable row level security;

-- Leitura para a organização; ESCRITA só de `manager` para cima (molde 0204).
drop policy if exists catalog_media_select on public.catalog_media;
create policy catalog_media_select on public.catalog_media
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists catalog_media_write on public.catalog_media;
create policy catalog_media_write on public.catalog_media
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.catalog_media from anon;
grant select, insert, update, delete on public.catalog_media to authenticated;
grant all on public.catalog_media to service_role;

drop trigger if exists trg_catalog_media_updated_at on public.catalog_media;
create trigger trg_catalog_media_updated_at
  before update on public.catalog_media
  for each row execute function public.fn_set_updated_at();

comment on table public.catalog_media is
  'Mídias de marca do catálogo (hoje: vídeo) que o agente de IA manda por papel/código — ex.: depoimento (prova social) e logistica (entrega). Distinto das fotos por produto (catalog_products.fotos): aqui a identidade é o PAPEL no funil, não o SKU.';
comment on column public.catalog_media.codigo is
  'O papel da mídia no funil (ex.: depoimento, logistica). É o valor que o prompt usa em video_codigo; estável entre deploys — trocar o arquivo não muda o prompt.';
comment on column public.catalog_media.storage_path is
  'Caminho em storage/catalog-video, sempre <organization_id>/<uuid>.<ext>. A leitura por service role confere o prefixo da organização.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-video', 'catalog-video', false, 52428800, array['video/mp4'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
