import { describe, expect, it } from "vitest";

import {
  FRACAO_DO_BATIMENTO,
  batimentoAplicavel,
  intervaloDoBatimento,
  quandoBater,
} from "@/lib/agent-engine/queue/lease";

/**
 * A ARITMÉTICA DO BATIMENTO — a decisão que o `main.ts` consulta a cada batida.
 *
 * O caso de campo está medido em `lease.ts`: os turnos desta VPS duram até 584 s
 * contra um lease de 600 s. Estas asserções prendem as DUAS pontas do conserto:
 * que o intervalo caiba várias vezes dentro do lease (senão o batimento não
 * salva o turno lento) e que ele nunca vire laço quente com lease minúsculo
 * (senão um teste com lease de 100 ms martelaria o banco).
 */
describe("intervaloDoBatimento", () => {
  it("bate a cada 1/3 do lease — três batidas por janela", () => {
    expect(intervaloDoBatimento(600_000)).toBe(200_000);
    expect(intervaloDoBatimento(30 * 60_000)).toBe(10 * 60_000);
    expect(FRACAO_DO_BATIMENTO).toBeCloseTo(1 / 3, 10);
  });

  it("piso de 1 s: lease minúsculo em teste não vira laço quente", () => {
    // Sem o piso, `leaseMs = 30` daria um batimento a cada 10 ms — 100 updates
    // por segundo numa linha de `job_queue` só para provar o lease.
    expect(intervaloDoBatimento(30)).toBe(1_000);
    expect(intervaloDoBatimento(0)).toBe(1_000);
    expect(intervaloDoBatimento(-5)).toBe(1_000);
    expect(intervaloDoBatimento(1_500)).toBe(1_000);
    expect(intervaloDoBatimento(3_600)).toBe(1_200);
  });

  it("o próximo batimento cai dentro do lease a partir do último sinal", () => {
    // A lei que dá sentido ao batimento: intervalo < lease. Se a fração virar
    // >= 1, o reaper vence o job ANTES do primeiro sinal seguinte, e o conserto
    // inteiro vira decoração.
    for (const lease of [3_000, 60_000, 600_000, 1_800_000]) {
      const intervalo = intervaloDoBatimento(lease);
      expect(intervalo, `lease de ${lease} ms`).toBeLessThan(lease);
      expect(quandoBater(1_000, lease)).toBe(1_000 + intervalo);
    }
  });
});

/**
 * A guarda de dono. É a MESMA condição que `baterNoJob` (SQL) e os desfechos
 * (`completeJob`/`failJob`/`cancelJob`) aplicam; aqui ela é predicado puro para
 * o caso de borda ficar legível — e para o teste de invariante poder afirmar
 * que as duas não divergiram.
 */
describe("batimentoAplicavel", () => {
  const base = {
    status: "running",
    locked_by: "w1",
    locked_at: "2026-10-14T10:00:00.000001Z",
    workerId: "w1",
    acquiredAt: "2026-10-14T10:00:00.000001Z",
  };

  it("casa quando a linha é 'running', é do worker e está no locked_at que ele gravou", () => {
    expect(batimentoAplicavel(base)).toBe(true);
  });

  it("não bate num job que não está mais 'running'", () => {
    for (const status of ["pending", "done", "failed", "dead"]) {
      expect(batimentoAplicavel({ ...base, status }), status).toBe(false);
    }
  });

  it("não bate no lease de OUTRO worker (re-claim pós reaper)", () => {
    expect(batimentoAplicavel({ ...base, locked_by: "w2" })).toBe(false);
    expect(batimentoAplicavel({ ...base, locked_by: null })).toBe(false);
  });

  it("não bate quando o locked_at já não é o que este worker gravou", () => {
    // O caso real: o reaper devolveu o job e outro worker o pegou. Insistir no
    // batimento aqui mascararia a perda do lease — o desfecho ainda recusaria
    // commitar, mas o worker acharia que ainda é dono.
    expect(batimentoAplicavel({ ...base, locked_at: "2026-10-14T10:00:09.000000Z" })).toBe(false);
  });

  it("sem o texto do claim, cai só na identidade do worker — como o `$3 is null` do SQL", () => {
    expect(batimentoAplicavel({ ...base, acquiredAt: undefined })).toBe(true);
    expect(batimentoAplicavel({ ...base, acquiredAt: undefined, locked_by: "w2" })).toBe(false);
  });
});
