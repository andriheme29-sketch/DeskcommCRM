/**
 * A RETENTATIVA DO AGENTE — o agente insiste quando o cliente para de responder.
 *
 * O dono descreveu o caso: "o cliente tá conversando e para de responder; o
 * agente persiste duas tentativas de 3 em 3 horas; sem resposta, vai para
 * remarketing". Isso NÃO é um follow-up desenhado à mão: é uma escolha feita na
 * tela do agente, como a voz. Por baixo, vira um fluxo de verdade — um pointer
 * com a `escada` de 2 toques escrita pela IA — publicado e armado no agente.
 *
 * Por que materializar e não inventar um segundo motor: o motor de fluxo já
 * tem a espera, o cancelamento na resposta (`cancel_on_reply`), o anti-ban, a
 * janela, o claim atômico, o "uma inscrição viva por lead" e a trilha. Um motor
 * paralelo seria a única forma de errar esses seis de uma vez.
 *
 * O gatilho é `agente_sem_resposta` (o AGENTE falou por último e o cliente não
 * voltou), e o gate de etapa final barra quem já saiu do funil — os dois já no
 * motor. Aqui só se monta e se publica o fluxo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { montarEscada, type Toque } from "@/lib/followup/modelos/escada";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { logger } from "@/lib/logger";

const HORA_MS = 3_600_000;

/** O que o agente recebe de orientação em cada toque — a "voz" da retomada. */
export const PROMPT_HINT_DA_RETENTATIVA =
  "Retome a conversa com o cliente de forma breve e natural, na sua voz, sem cobrar resposta e " +
  "sem repetir o que já foi dito. Esta é uma tentativa de reengajar quem parou de responder.";

export interface RetentativaKnobs {
  enabled: boolean;
  intervalo_horas: number;
  tentativas: number;
}

/** O nome do pointer é estável por agente — é a chave da idempotência. */
export function nomeDoPointerDeRetentativa(agentName: string): string {
  return `Retentativa — ${agentName}`;
}

/**
 * O grafo da retentativa: a MESMA espinha da escada de clínica (trigger → toque
 * → espera a resposta → próximo toque → fim "sem resposta"), com dois ajustes:
 *
 *  - a ação é `ai_message` (o agente escreve), não texto fixo;
 *  - o PRIMEIRO toque não espera (`esperaAntesMs` ausente): o gatilho já só
 *    dispara 3 h depois de o agente falar, então a espera entre tentativas é o
 *    `prazoDeRespostaMs` do nó de resposta — `intervalo_horas` de cada vez.
 *
 * Assim: agente fala → [3 h] → tentativa 1 → [3 h] → tentativa 2 → sem resposta
 * → o negócio sai do funil como esgotado (é o gancho do remarketing).
 */
export function montarGrafoDeRetentativa(knobs: { intervalo_horas: number; tentativas: number }): FlowGraph {
  const esperaMs = Math.max(1, knobs.intervalo_horas) * HORA_MS;
  const tentativas = Math.max(1, knobs.tentativas);
  const toques: Toque[] = Array.from({ length: tentativas }, (_, i) => ({
    texto: "(o agente escreve)",
    rotulo: tentativas === 1 ? "Tentativa" : `Tentativa ${i + 1}`,
  }));
  const base = montarEscada({
    toques,
    prazoDeRespostaMs: esperaMs,
    sim: { rotulo: "Respondeu", padrao: "sim" },
    notaDeResposta: "O cliente respondeu — o atendimento assume daqui.",
  });
  // A escada monta `text`; a retentativa é `ai_message`. Troca só o config das
  // ações e revalida o grafo inteiro — saída de ramo e cobertura continuam as
  // que `montarEscada` garante.
  const grafo = {
    ...base,
    nodes: base.nodes.map((n) =>
      n.type === "action"
        ? { ...n, config: { mode: "ai_message", prompt_hint: PROMPT_HINT_DA_RETENTATIVA } }
        : n,
    ),
  };
  return flowGraphSchema.parse(grafo);
}

export interface MaterializarRetentativaInput {
  orgId: string;
  agentId: string;
  agentName: string;
  createdBy: string;
  knobs: { intervalo_horas: number; tentativas: number };
}

/**
 * Garante que existe o fluxo publicado da retentativa DESTE agente e devolve o
 * pointer. Idempotente: chamar de novo com os mesmos knobs acha o mesmo pointer
 * e não republica (o grafo é comparado antes). Com knobs diferentes, republica.
 *
 * Nunca lança: uma falha aqui não pode derrubar o salvamento do agente — o
 * resultado devolve `pointerId: null` e quem chamou decide (hoje: grava a versão
 * sem o pointer e loga; a retentativa simplesmente não arma).
 */
export async function materializarRetentativaDoAgente(
  admin: SupabaseClient,
  input: MaterializarRetentativaInput,
): Promise<{ pointerId: string | null }> {
  const nome = nomeDoPointerDeRetentativa(input.agentName);
  const grafo = montarGrafoDeRetentativa(input.knobs);

  const publicavel = validateFlowForPublish(grafo);
  if (!publicavel.ok) {
    logger.warn("[retentativa] grafo reprovado no publish — não armado", {
      agent_id: input.agentId,
      errors: publicavel.errors.slice(0, 3),
    });
    return { pointerId: null };
  }

  const trigger = {
    kind: "agente_sem_resposta" as const,
    params: { threshold_minutes: input.knobs.intervalo_horas * 60 },
    cancel_on_reply: true,
  };

  const { data: existente, error: buscaErr } = await admin
    .from("followup_flow_pointers")
    .select("id, active_version_id, draft_graph, trigger_config")
    .eq("organization_id", input.orgId)
    .eq("name", nome)
    .maybeSingle();
  if (buscaErr) {
    logger.warn("[retentativa] falha ao procurar o fluxo do agente", {
      agent_id: input.agentId,
      error: buscaErr.message.slice(0, 160),
    });
    return { pointerId: null };
  }

  if (!existente) {
    const { data: criado, error: insErr } = await admin
      .from("followup_flow_pointers")
      .insert({
        organization_id: input.orgId,
        name: nome,
        draft_graph: grafo,
        trigger_config: trigger,
        handoff_policy: "allow",
      })
      .select("id")
      .single();
    if (insErr || !criado) {
      logger.warn("[retentativa] falha ao criar o fluxo do agente", {
        agent_id: input.agentId,
        error: (insErr?.message ?? "no_row").slice(0, 160),
      });
      return { pointerId: null };
    }
    const pub = await publishFollowupFlowVersion(admin, {
      orgId: input.orgId,
      pointerId: criado.id,
      graph: grafo,
      createdBy: input.createdBy,
    });
    if (!pub.ok) {
      logger.warn("[retentativa] fluxo criado mas não publicado", {
        agent_id: input.agentId,
        error: pub.message.slice(0, 160),
      });
      return { pointerId: null };
    }
    return { pointerId: criado.id };
  }

  // Já existe: o grafo bate com os knobs desejados? Então não republica.
  const atual = flowGraphSchema.safeParse(existente.draft_graph);
  const precisaRepublicar =
    !existente.active_version_id || !atual.success || JSON.stringify(atual.data) !== JSON.stringify(grafo);
  if (precisaRepublicar) {
    // O draft carrega o grafo desejado; o publish o ativa atomicamente.
    const { error: updErr } = await admin
      .from("followup_flow_pointers")
      .update({ draft_graph: grafo, trigger_config: trigger })
      .eq("id", existente.id)
      .eq("organization_id", input.orgId);
    if (updErr) {
      logger.warn("[retentativa] falha ao atualizar o rascunho do fluxo", {
        agent_id: input.agentId,
        error: updErr.message.slice(0, 160),
      });
      return { pointerId: existente.id };
    }
    const pub = await publishFollowupFlowVersion(admin, {
      orgId: input.orgId,
      pointerId: existente.id,
      graph: grafo,
      createdBy: input.createdBy,
    });
    if (!pub.ok) {
      logger.warn("[retentativa] falha ao republicar o fluxo", {
        agent_id: input.agentId,
        error: pub.message.slice(0, 160),
      });
    }
  }
  return { pointerId: existente.id };
}

/**
 * Funde o resultado nos knobs do agente: liga `enabled` (o gate exige) e põe o
 * pointer na lista. Preserva os fluxos que o agente JÁ armava — o controle da
 * retentativa não desarma o follow-up de ninguém.
 */
export function comPointerDaRetentativa(
  followup: { enabled: boolean; flow_pointer_ids: string[] },
  pointerId: string | null,
): { enabled: boolean; flow_pointer_ids: string[] } {
  if (!pointerId) return followup;
  if (followup.flow_pointer_ids.includes(pointerId)) return { ...followup, enabled: true };
  return { enabled: true, flow_pointer_ids: [...followup.flow_pointer_ids, pointerId] };
}