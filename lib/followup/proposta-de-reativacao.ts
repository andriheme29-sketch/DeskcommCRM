/**
 * A RETENTATIVA ESGOTOU → o negócio VAI PARA REATIVAÇÃO (remarketing).
 *
 * O dono descreveu o fim do laço: "sem resposta às duas tentativas, vai para
 * remarketing". Isso reusa o que já existe — `propoeReativacao` (a linha em
 * `crm_lead_reactivations` que o `risk-watcher` cria quando um negócio esfria).
 * A diferença é o GATILHO: aqui a proposta nasce porque o fluxo de retentativa
 * do agente chegou ao fim SEM resposta (`outcome='exhausted'`), não porque o
 * relógio de esfriamento venceu.
 *
 * A regra é PURA (testável sem banco), como `no-show-recuperacao-esgotada.ts`:
 * quem grava é o adaptador em `engine.ts`, e ele resolve o LEAD a partir do
 * contato (o enrollment carrega `contact_id`, não o negócio).
 *
 * ⚠️ ESCOPO — só a retentativa. Um fluxo esgotado QUALQUER (uma régua de
 * clínica que ninguém respondeu) NÃO propõe reativação: isso já é coberto pela
 * proposta de esfriamento, e disparar nos dois lugares duplicaria a decisão.
 * Quem sabe que o enrollment é da retentativa é o `trigger_config` do pointer —
 * o engine pergunta antes (`ehFluxoDeRetentativa`).
 */
import { RISK_COLD_HOURS } from "@/lib/leads/risk-radar";

import type { NodeResult } from "./node-handlers";

/**
 * Por quantas horas a proposta de reativação fica viva antes de vencer sozinha.
 * Mesma janela que o esfriamento usa por padrão (`RISK_COLD_HOURS` = 24 h): a
 * proposta é um pedido de atenção, e um pedido que não vence faz a Central
 * mentir que ainda há algo a decidir.
 */
export const COLD_HOURS_DA_REATIVACAO = RISK_COLD_HOURS;

/**
 * Deve propor reativação? Só quando TODAS valem:
 *  - o passo não é replay (senão um reprocesso abriria proposta de novo; o
 *    "uma proposta viva por lead" de `propoeReativacao` cobre, mas nem chega lá);
 *  - o enrollment terminou de verdade (`complete`) com outcome `exhausted` —
 *    `replied` (o cliente voltou, via `cancel_on_reply`) não propõe;
 *  - o fluxo é o da retentativa (`ehRetentativa`), não um fluxo qualquer.
 */
export function deveProporReativacao(args: {
  result: NodeResult;
  isReplay: boolean;
  ehRetentativa: boolean;
}): boolean {
  if (args.isReplay) return false;
  if (!args.ehRetentativa) return false;
  return args.result.kind === "complete" && args.result.outcome === "exhausted";
}