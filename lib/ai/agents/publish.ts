/**
 * Publish wrapper around the SQL function fn_publish_ai_agent_version.
 * Spec 10 §4.5.
 *
 * Returns a discriminated result so the caller maps validation errors to 422
 * with a stable error code, and unknown errors to 500.
 */
import { chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { logger } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLISH_ERROR_CODES, type PublishErrorCode, followupConfigSchema } from "./validation";
import { comPointerDaRetentativa, materializarRetentativaDoAgente } from "./retentativa";

export interface PublishOk {
  ok: true;
  agent_id: string;
  version_id: string;
  previous_version_id: string | null;
  published_at: string;
}

export interface PublishFail {
  ok: false;
  code: PublishErrorCode | "internal_error";
  message: string;
}

export type PublishResult = PublishOk | PublishFail;

interface PublishRow {
  agent_id: string;
  version_id: string;
  previous_version_id: string | null;
  published_at: string;
}

export async function publishAgentVersion(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string; versionId: string; expectedProvenance?: "onboarding" | "legacy_reconciliation" },
): Promise<PublishResult> {
  const { data: version, error: readError } = await admin
    .from("ai_agent_versions")
    .select("provider,credential_id")
    .eq("organization_id", params.orgId)
    .eq("agent_id", params.agentId)
    .eq("id", params.versionId)
    .maybeSingle();
  if (readError || !version)
    return { ok: false, code: "version_not_found", message: "version_not_found" };
  const platform = version.credential_id === null;
  if (platform && !chaveDePlataforma(version.provider))
    return { ok: false, code: "credential_missing", message: "credential_missing" };

  // ANTES de publicar: garante a RETENTATIVA, se o agente a escolheu. Aqui o
  // rascunho ainda é `draft` e MUTÁVEL — depois do publish a trava de conteúdo
  // congela `flow_pointer_ids`, e nunca mais dá para armar o ponteiro na versão
  // publicada (o gate lê exatamente essa versão). Best-effort e ADITIVO: falha
  // aqui loga e segue, publicar o agente nunca quebra por causa dela.
  await armarRetentativaSePedida(admin, {
    orgId: params.orgId,
    agentId: params.agentId,
    versionId: params.versionId,
  });

  const { data, error } = await admin.rpc("fn_publish_ai_agent_version", {
    p_org_id: params.orgId,
    p_agent_id: params.agentId,
    p_version_id: params.versionId,
    ...(params.expectedProvenance ? { p_platform_credential_verified: platform, p_expected_provenance: params.expectedProvenance } : platform ? { p_platform_credential_verified: true } : {}),
  });

  if (error) {
    // Postgres P0001 with the reason as message.
    const raw = (error.message ?? "").trim();
    if (PUBLISH_ERROR_CODES.has(raw)) {
      return { ok: false, code: raw as PublishErrorCode, message: raw };
    }
    return { ok: false, code: "internal_error", message: raw || "publish_failed" };
  }

  const row = Array.isArray(data)
    ? (data[0] as PublishRow | undefined)
    : (data as PublishRow | null);
  if (!row) {
    return { ok: false, code: "internal_error", message: "no_row_returned" };
  }

  return {
    ok: true,
    agent_id: row.agent_id,
    version_id: row.version_id,
    previous_version_id: row.previous_version_id,
    published_at: row.published_at,
  };
}

async function armarRetentativaSePedida(
  admin: SupabaseClient,
  ids: { orgId: string; agentId: string; versionId: string },
): Promise<void> {
  try {
    const { data: draft } = await admin
      .from("ai_agent_versions")
      .select("followup, created_by, superseded_at")
      .eq("organization_id", ids.orgId)
      .eq("agent_id", ids.agentId)
      .eq("id", ids.versionId)
      .maybeSingle();
    if (!draft) return;

    const cfg = followupConfigSchema.safeParse(draft.followup ?? {});
    const ret = cfg.success ? cfg.data.retentativa : null;
    if (!ret?.enabled) return;

    const { data: agente } = await admin
      .from("ai_agents")
      .select("name")
      .eq("organization_id", ids.orgId)
      .eq("id", ids.agentId)
      .maybeSingle();
    const agentName = (agente as { name?: string } | null)?.name ?? "Agente";

    const { pointerId } = await materializarRetentativaDoAgente(admin, {
      orgId: ids.orgId,
      agentId: ids.agentId,
      agentName,
      createdBy: (draft.created_by as string | null) ?? "",
      knobs: { intervalo_horas: ret.intervalo_horas, tentativas: ret.tentativas },
    });
    if (!pointerId) return;
    if (cfg.success && cfg.data.flow_pointer_ids.includes(pointerId)) return;

    // O ponteiro entra no RASCUNHO, que ainda é `status='draft'` neste ponto —
    // logo a trava de conteúdo não o barra. Feito ANTES do publish, o conteúdo
    // publicado já nasce com o ponteiro armado; feito depois, seria imutável.
    const base = cfg.success ? cfg.data : followupConfigSchema.parse({});
    const proximo = comPointerDaRetentativa(
      { enabled: base.enabled, flow_pointer_ids: base.flow_pointer_ids },
      pointerId,
    );
    const { error } = await admin
      .from("ai_agent_versions")
      .update({ followup: { ...base, ...proximo } })
      .eq("organization_id", ids.orgId)
      .eq("agent_id", ids.agentId)
      .eq("id", ids.versionId)
      .eq("status", "draft");
    if (error) {
      logger.warn("[retentativa] fluxo pronto, mas o ponteiro não pôde ser armado na versão", {
        agent_id: ids.agentId,
        version_id: ids.versionId,
        error: error.message.slice(0, 160),
      });
    }
  } catch (err) {
    logger.warn("[retentativa] falha best-effort ao armar a retentativa", {
      agent_id: ids.agentId,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
