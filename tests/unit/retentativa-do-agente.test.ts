/**
 * A RETENTATIVA DO AGENTE — as partes puras.
 *
 * O que este arquivo prende: o grafo que vira fluxo (2 toques de IA, espera de
 * 3 h, sem resposta → esgotado), o nome estável do pointer (a chave da
 * idempotência) e a fusão que ARMA o pointer sem desarmar os fluxos que o
 * agente já tinha.
 *
 * O que NÃO prova: criar/publicar o fluxo de verdade (isso é banco e Supabase;
 * o materializador é best-effort e coberto pela prova pela tela).
 */
import { describe, expect, it } from "vitest";

import {
  comPointerDaRetentativa,
  montarGrafoDeRetentativa,
  nomeDoPointerDeRetentativa,
  PROMPT_HINT_DA_RETENTATIVA,
} from "@/lib/ai/agents/retentativa";

describe("montarGrafoDeRetentativa", () => {
  it("monta 2 toques escritos pela IA e um fim 'sem resposta'", () => {
    const g = montarGrafoDeRetentativa({ intervalo_horas: 3, tentativas: 2 });
    const acoes = g.nodes.filter((n) => n.type === "action");
    expect(acoes).toHaveLength(2);
    for (const a of acoes) {
      expect(a.config).toMatchObject({ mode: "ai_message", prompt_hint: PROMPT_HINT_DA_RETENTATIVA });
    }
    const fim = g.nodes.find((n) => n.type === "end" && (n.config as { outcome?: string }).outcome === "exhausted");
    expect(fim).toBeDefined();
  });

  it("a espera entre tentativas é o intervalo escolhido", () => {
    const g = montarGrafoDeRetentativa({ intervalo_horas: 3, tentativas: 2 });
    const respostas = g.nodes.filter((n) => n.type === "match_reply");
    for (const r of respostas) {
      expect((r.config as { grace_timeout_ms: number }).grace_timeout_ms).toBe(3 * 3_600_000);
    }
  });

  it("respeita o número de tentativas pedido", () => {
    expect(montarGrafoDeRetentativa({ intervalo_horas: 1, tentativas: 5 }).nodes.filter((n) => n.type === "action")).toHaveLength(5);
    expect(montarGrafoDeRetentativa({ intervalo_horas: 1, tentativas: 1 }).nodes.filter((n) => n.type === "action")).toHaveLength(1);
  });
});

describe("nomeDoPointerDeRetentativa", () => {
  it("é estável por nome de agente (a chave da idempotência)", () => {
    expect(nomeDoPointerDeRetentativa("Kênia")).toBe("Retentativa — Kênia");
    expect(nomeDoPointerDeRetentativa("Kênia")).toBe(nomeDoPointerDeRetentativa("Kênia"));
  });
});

describe("comPointerDaRetentativa", () => {
  it("arma e acrescenta o pointer, preservando os que já existiam", () => {
    const r = comPointerDaRetentativa({ enabled: false, flow_pointer_ids: ["fluxo-antigo"] }, "ptr-ret");
    expect(r.enabled).toBe(true);
    expect(r.flow_pointer_ids.sort()).toEqual(["fluxo-antigo", "ptr-ret"]);
  });

  it("não duplica se o pointer já está armado", () => {
    const r = comPointerDaRetentativa({ enabled: true, flow_pointer_ids: ["ptr-ret"] }, "ptr-ret");
    expect(r.flow_pointer_ids).toEqual(["ptr-ret"]);
  });

  it("sem pointer (materialização falhou), não mexe em nada", () => {
    const base = { enabled: false, flow_pointer_ids: [] };
    expect(comPointerDaRetentativa(base, null)).toEqual(base);
  });
});
