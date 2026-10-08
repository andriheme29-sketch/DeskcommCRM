-- ============================================================================
-- 2026-10-08 — 0591: VOZ DO AGENTE — ESCOLHA E MODO
-- manifest: cinco colunas aditivas em ai_agent_versions (provedor, chave, voz, modelo e modo) para o agente escolher a própria voz e QUANDO falar em vez de escrever; a trava de imutabilidade da versão publicada passa a cobri-las.
--
-- A voz do agente (nota de voz no WhatsApp) existia só por variável de
-- ambiente e a decisão de mandar áudio era 100% do prompt. Com a tela de
-- credenciais ganhando provedor de voz, a escolha passa a morar onde as outras
-- escolhas do agente moram: na VERSÃO PUBLICADA.
--
--  - `voice_mode` — quando falar em vez de escrever. Quatro modos fechados
--    (`nunca`, `sempre`, `quando_cliente_fala`, `decidir`). `null` = o
--    comportamento de ANTES desta migration (o modelo decide pelo prompt), e é
--    o que mantém retrocompatível todo agente já publicado. A tela oferece
--    `nunca` como escolha; o `null` é só o estado de quem nunca mexeu.
--  - `voice_provider`, `voice_credential_id`, `voice_id`, `voice_model` — o
--    provedor de voz, a chave (linha de ai_provider_credentials), a voz e o
--    modelo. `on delete set null` e NÃO `restrict` como o `credential_id` de
--    texto: apagar uma chave de voz não pode travar a exclusão como travou a de
--    texto (ver o beco documentado em app/api/v1/ai/credentials/[id]/route.ts).
--    A versão cai para a escada da organização.
--
-- Aditiva e idempotente (`add column if not exists`). Nenhum agente muda de
-- comportamento: toda coluna nasce `null`.
--
-- A trava de imutabilidade (`fn_ai_agent_version_content_immutable`) é
-- REDEFINIDA aqui com as cinco colunas: a lista é escrita à mão, e uma coluna
-- de conteúdo nova que fique fora dela reabre a cerca para a service key —
-- exatamente o defeito que `tests/unit/trigger-imutavel-cobre-todas-as-colunas-de-conteudo.test.ts`
-- previne (histórico: proposal_ai_draft_enabled e inbound_debounce_ms ficaram
-- fora na primeira vez). Sem `security definer` e com `set search_path = ''` na
-- PRÓPRIA definição — um create or replace sem a cláusula apagaria o
-- `alter function ... set search_path` e o security advisor acusaria.
--
-- Sem função NOVA em `public` ⇒ o item 9 da doutrina não é acionado (esta
-- apenas redefine uma que já existe e já está revogada).
-- ============================================================================

alter table public.ai_agent_versions
  add column if not exists voice_mode text;
alter table public.ai_agent_versions
  add column if not exists voice_provider text;
alter table public.ai_agent_versions
  add column if not exists voice_credential_id uuid;
alter table public.ai_agent_versions
  add column if not exists voice_id text;
alter table public.ai_agent_versions
  add column if not exists voice_model text;

-- O vocabulário de `voice_mode` é FECHADO e fica no banco: a coluna nasce agora,
-- não tem valor legado em clone nenhum, e um modo fora da lista é um defeito de
-- escrita (não um dado antigo a preservar). `null` continua válido — é o estado
-- "nunca configurado".
alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_voice_mode_check;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_voice_mode_check
  check (voice_mode is null or voice_mode in ('nunca', 'sempre', 'quando_cliente_fala', 'decidir'));

-- A chave da voz é uma credencial da MESMA organização. `on delete set null`:
-- apagar a chave não apaga a ESCOLHA de provedor/voz do agente — ele só deixa de
-- ter para onde apontar e cai na escada da organização, sem quebrar o turno.
alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_voice_credential_id_fkey;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_voice_credential_id_fkey
  foreign key (voice_credential_id) references public.ai_provider_credentials(id)
  on delete set null;

create or replace function fn_ai_agent_version_content_immutable() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.proposal_ai_draft_enabled is distinct from old.proposal_ai_draft_enabled
    or new.inbound_debounce_ms    is distinct from old.inbound_debounce_ms
    or new.voice_mode             is distinct from old.voice_mode
    or new.voice_provider         is distinct from old.voice_provider
    or new.voice_credential_id    is distinct from old.voice_credential_id
    or new.voice_id               is distinct from old.voice_id
    or new.voice_model            is distinct from old.voice_model
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();

-- Índice parcial da chave de voz: a FK é conferida na exclusão da credencial, e
-- sem índice isso varreria a tabela inteira (a de texto já tem o seu).
create index if not exists idx_ai_agent_versions_voice_credential
  on public.ai_agent_versions (voice_credential_id)
  where voice_credential_id is not null;

notify pgrst, 'reload schema';