import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/agents/:id/publish  body: { version_id }
 *
 * Atomic flip via fn_publish_ai_agent_version (Spec 10 §4.5):
 *   - prev published version → 'superseded'
 *   - target version → 'published'
 *   - ai_agents.published_version_id → target
 * Validates credential, channel_session, model and tool_ids before commit.
 *
 * Maps validation errors to 422 with stable codes (PublishErrorCode).
 * Emits event_log 'ai_agent.published' fire-and-forget after commit.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishSchema, PUBLISH_ERROR_CODES } from "@/lib/ai/agents/validation";
import { toolIdAceito } from "@/lib/mcp/servidor-externo/ids";
import { VALID_TOOL_IDS } from "@/lib/mcp/tools";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { traduzir } from "@/lib/i18n/dicionario";

const VALID_TOOL_IDS_RUNTIME = new Set<string>(VALID_TOOL_IDS as readonly string[]);

/** Catálogo compilado + ferramenta remota escolhida (item 6) — ver `toolIdAceito`. */
const toolIdValido = (t: string) => toolIdAceito(t, VALID_TOOL_IDS_RUNTIME);

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "ai_agents",
    role: "admin",
    scope: "config:write",
    tokenRole: "admin",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? "pt-BR");
  const { organizationId, actor } = authz;

  const teto = await tetoDeEscritaDoToken(authz, "ai_agents_publish", requestId);
  if (teto) return teto;
  const authUserId = actor.type === "user" ? actor.id : null;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }

  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();

  // Pre-flight: tool_ids do target version são válidos no catálogo MCP atual?
  // (catálogo evolui — validar à hora do publish, fora da transação SQL.)
  const { data: targetV } = await admin
    .from("ai_agent_versions")
    .select("id, agent_id, organization_id, tool_ids, status, channel_session_id")
    .eq("id", parsed.data.version_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!targetV || targetV.agent_id !== id) {
    return fail("version_not_found", t("Version não encontrada."), 404, { requestId });
  }

  const tools = (targetV.tool_ids ?? []) as string[];
  const invalid = tools.filter((t) => !toolIdValido(t));
  if (invalid.length > 0) {
    return fail("tool_id_invalid", t("tool_ids contém ids inexistentes no catálogo MCP."), 422, {
      requestId,
      details: { invalid },
    });
  }

  // O NÚMERO JÁ TEM DONO? Um `channel_session_id` é um recurso único: dois
  // agentes publicados NELE nunca é o que se quer — o turno elege um dos dois
  // por `priority`/`created_at` (`agente-da-conversa.ts`), sem ninguém ter
  // escolhido. Trocar de agente num número é operação legítima, e por isso não
  // é proibida: exige CONFIRMAÇÃO explícita (`confirmar_troca_numero`), que é o
  // que separa "eu quis" de "eu não vi que este número estava ocupado".
  //
  // A consulta só olha o ponteiro VIGENTE (`published_version_id`) e o status
  // `published` — rascunho em outro agente não ocupa nada.
  if (targetV.channel_session_id !== null && parsed.data.confirmar_troca_numero !== true) {
    const { data: ocupantes, error: ocupantesErr } = await admin
      .from("ai_agents")
      .select("id, ai_agent_versions!ai_agents_published_version_id_fkey!inner(channel_session_id, status)")
      .eq("organization_id", organizationId)
      .neq("id", id)
      .is("archived_at", null)
      .eq("ai_agent_versions.channel_session_id", targetV.channel_session_id)
      .eq("ai_agent_versions.status", "published");

    if (ocupantesErr) {
      return fail("internal_error", t("Erro ao verificar o número."), 500, { requestId });
    }
    if ((ocupantes?.length ?? 0) > 0) {
      return fail(
        "channel_session_already_taken",
        t(
          "Este número já tem outro agente publicado. Confirme a troca para publicar este no lugar dele.",
        ),
        422,
        { requestId, details: { agentes: ocupantes?.map((o) => o.id) ?? [] } },
      );
    }
  }

  const result = await publishAgentVersion(admin, {
    orgId: organizationId,
    agentId: id,
    versionId: parsed.data.version_id,
  });

  if (!result.ok) {
    if (PUBLISH_ERROR_CODES.has(result.code as string)) {
      const status = result.code === "agent_not_found" || result.code === "version_not_found"
        ? 404
        : 422;
      return fail(result.code, t("Validação de publish falhou."), status, { requestId });
    }
    return fail("internal_error", "Erro ao publicar.", 500, { requestId });
  }

  // event_log + audit fire-and-forget.
  void admin
    .from("event_log")
    .insert({
      organization_id: organizationId,
      event_type: "ai_agent.published",
      // NOT NULL sem default — ver `tests/unit/evento-de-publicacao-tem-dono.test.ts`.
      entity_kind: "ai_agent",
      payload: {
        agent_id: result.agent_id,
        version_id: result.version_id,
        previous_version_id: result.previous_version_id,
        published_at: result.published_at,
      },
    })
    .then(({ error }) => {
      if (error) console.error("[ai_agents/publish] event_log error", error.message);
    });

  void audit({
    action: "ai_agent.published",
    actorUserId: authUserId,
    actorApiTokenId: authz.apiTokenId ?? null,
    organizationId: organizationId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
    metadata: {
      version_id: result.version_id,
      previous_version_id: result.previous_version_id,
    },
  });

  return ok(
    {
      agent_id: result.agent_id,
      version_id: result.version_id,
      previous_version_id: result.previous_version_id,
      published_at: result.published_at,
    },
    { requestId },
  );
}
