/**
 * O BATIMENTO DO LEASE — manter vivo o job que ainda está sendo processado.
 *
 * ## O defeito que este arquivo conserta
 *
 * `claimJobs` grava `locked_at = now()` UMA vez, no instante do claim, e nunca
 * mais toca nessa coluna. O reaper (`reapExpiredJobs`) considera órfão todo job
 * 'running' cujo `locked_at` ficou mais velho que `QUEUE_VISIBILITY_TIMEOUT_MS`,
 * devolve o job a 'pending' e outro worker o re-claima — com um `locked_by` novo
 * e `attempts` incrementado. Quando o PRIMEIRO worker termina, o `completeJob`
 * dele perde a corrida do `where ... and locked_by = $2 and locked_at = $3` e
 * recusa commitar ("lease do job ... perdido no complete"): o turno inteiro —
 * a chamada principal do agente, o envio, o checkpoint — é descartado e refeito.
 *
 * Medido nesta VPS (2026-10-14), contra os logs do worker das últimas 72 h: os
 * turnos concluídos duram **mediana 78 s, p90 228 s, máx 584 s**, contra um
 * lease de **600 s**. Ou seja: o teto do lease estava a DEZESSEIS SEGUNDOS do
 * turno mais lento já medido, e a cauda (356–584 s) vive na zona de perigo. Um
 * único turno que cruze 600 s — ou um worker que morra no meio — perde o turno,
 * que retorna à fila e é refeito por inteiro.
 *
 * ## O conserto tem DUAS camadas, e as duas importam
 *
 * 1. **O batimento** (aqui): enquanto o turno roda, o worker reescreve
 *    `locked_at = now()` num ritmo que caiba várias vezes dentro do lease. Com
 *    isso, o tempo de VIDA do lease passa a medir o tempo desde o último sinal,
 *    não o tempo desde o claim — e o job que está vivo, com o processo vivo, nunca
 *    é re-apontado como órfão, por mais lento que seja o turno.
 * 2. **O teto folgado** (`QUEUE_VISIBILITY_TIMEOUT_MS`, hoje 30 min): o
 *    batimento só falha se o laço de eventos travar (event loop bloqueado por um
 *    `JSON.parse` gigante, por exemplo) ou se a máquina morrer. O teto é a rede
 *    para ESSE caso, e por isso tem de ser folgado o bastante para não reeditar
 *    o defeito original por cima do turno mais lento possível.
 *
 * ## Por que a decisão mora aqui, pura, e a escrita não
 *
 * `quandoBater(ultimoSinal, leaseMs, agora)` é aritmética de relógio injetado —
 * testável sem Postgres e sem fake timers (o `vi.useFakeTimers` não fakeia
 * `node:timers/promises`, medido neste repo). A escrita (`bater`) é um `update`
 * de uma linha; o `main.ts` a pluga ao lado do handler do job.
 */

/** Fração do lease em que o batimento acontece. 1/3 deixa 3 batidas por janela:
 *  duas perdidas (event loop travado um tico) ainda cabem antes do reaper. */
export const FRACAO_DO_BATIMENTO = 1 / 3;

/**
 * Quanto esperar, a partir do último sinal, para dar o PRÓXIMO batimento.
 * Nunca menor que 1 s (um lease minúsculo em teste não pode virar laço quente).
 */
export function intervaloDoBatimento(leaseMs: number): number {
  return Math.max(Math.round(leaseMs * FRACAO_DO_BATIMENTO), 1_000);
}

/**
 * O instante em que o próximo batimento deve acontecer — `null` quando não há
 * lease para manter (`leaseMs` não positivo). Toma o `agora` por parâmetro para
 * o teste mandar o relógio.
 */
export function quandoBater(ultimoSinal: number, leaseMs: number): number {
  return ultimoSinal + intervaloDoBatimento(leaseMs);
}

/**
 * A MESMA condição de dono que `completeJob`/`failJob` usam, como predicado
 * puro — o batimento tem de escrever sob a MESMA guarda, senão ele mesmo
 * atropelaria o `locked_at` de um job que outro worker re-claimou (aplicando
 * batimento a um lease que não é mais deste worker, e mascarando a perda).
 */
export function batimentoAplicavel(opts: {
  status: string;
  locked_by: string | null;
  locked_at: string | null;
  workerId: string;
  acquiredAt: string | undefined;
}): boolean {
  if (opts.status !== "running") return false;
  if (opts.locked_by !== opts.workerId) return false;
  // `acquiredAt` ausente (job sem o texto do claim) cai só na identidade do
  // worker, como o `completeJob` faz com o `$3 is null`.
  if (opts.acquiredAt === undefined) return true;
  return opts.locked_at === opts.acquiredAt;
}
