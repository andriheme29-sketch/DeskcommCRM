import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O BATIMENTO DO LEASE TEM DE ESTAR LIGADO NO WORKER — não só existir.
 *
 * `baterNoJob` (SQL) e `lease.ts` (aritmética) têm prova própria: o invariante
 * `tests/invariants/queue-lease-batimento.test.ts` mede o lease contra um
 * Postgres de verdade. Mas a peça que faz o turno desta VPS parar de se perder
 * é uma LIGAÇÃO em `workers/agent-worker/main.ts`, e ela é invisível para
 * aquele invariante: apagar o `setInterval` deixa `queue.ts` intacto, o
 * invariante verde, e o defeito de volta — turno de 584 s re-claimado no meio
 * por um lease de 10 min.
 *
 * Este arquivo é a catraca dessa ligação, e ele mede o FONTE do worker (nunca
 * um mock): o defeito é a ausência de uma chamada, e ausência só se observa no
 * arquivo.
 *
 * ## O que ele NÃO afirma
 *
 * Que o batimento rodou. Isso é do invariante de banco. Aqui a pergunta é mais
 * estreita e é a que se perde num merge: o worker ainda bate, ainda para de
 * bater, e ainda entrega aos desfechos o `locked_at` RENOVADO.
 */
const FONTE = join(process.cwd(), "workers", "agent-worker", "main.ts");

/** O fonte sem comentários: prosa cita `baterNoJob` e `claimOfJob` à vontade, e
 *  uma cerca que casasse dentro de comentário mediria a documentação. */
function fonteDoWorker(): string {
  return readFileSync(FONTE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("o worker mantém vivo o lease do job que ainda roda", () => {
  const fonte = fonteDoWorker();

  it("importa as duas peças do batimento — a aritmética e a escrita", () => {
    expect(fonte, "o intervalo vem de lease.ts").toMatch(
      /import\s*\{[^}]*intervaloDoBatimento[^}]*\}\s*from\s*"@\/lib\/agent-engine\/queue\/lease"/,
    );
    expect(fonte, "e a escrita vem de queue.ts").toMatch(
      /import\s*\{[\s\S]*?baterNoJob[\s\S]*?\}\s*from\s*"@\/lib\/agent-engine\/queue\/queue"/,
    );
  });

  it("bate no ritmo que o lease manda — nunca num número solto", () => {
    // O ritmo TEM de sair de `intervaloDoBatimento(lease)`: um `setInterval(...,
    // 60_000)` fixo aqui sobreviveria a uma mudança de lease e passaria a bater
    // DEPOIS do vencimento, que é o defeito original com outra roupa.
    //
    // A âncora é `const heartbeat =`, e não só `setInterval(`: o worker tem
    // OUTRO intervalo (o do reaper), e uma sonda que casasse em qualquer
    // `setInterval` ficaria verde com o batimento apagado — desde que o reaper
    // continuasse de pé. Medido: é o que acontece.
    expect(fonte, "o intervalo do batimento tem de existir").toMatch(
      /const heartbeat = setInterval\([\s\S]{0,1200}?intervaloDoBatimento\(\s*env\.QUEUE_VISIBILITY_TIMEOUT_MS\s*\)/,
    );
  });

  it("para de bater quando o lease deixa de ser deste worker", () => {
    // `baterNoJob` devolve `null` nesse caso. Insistir mascararia a perda: o
    // worker acharia que ainda é dono de um job que outro já re-claimou.
    expect(fonte).toMatch(
      /baterNoJob\([\s\S]{0,200}?\.then\(\(novo\)\s*=>\s*\{[\s\S]{0,600}?novo === null/,
    );
  });

  it("o batimento morre junto com o job — `clearInterval` no finally", () => {
    // Sem isto o intervalo segue vivo depois do desfecho e reescreve
    // `locked_at` de uma linha que já não é 'running'.
    expect(fonte).toMatch(/finally\s*\{[\s\S]{0,400}?clearInterval\(heartbeat\)/);
  });

  it("os desfechos usam o lease RENOVADO, não o `locked_at` do claim", () => {
    // A armadilha de um caractere: passar `claimOfJob(job)?.acquired_at` para o
    // `completeJob` depois do primeiro batimento faz o desfecho perder a corrida
    // contra o PRÓPRIO batimento — o turno inteiro é descartado com o trabalho
    // feito. Medido em `queue-lease-batimento.test.ts`, caso "o desfecho com o
    // locked_at DO CLAIM é recusado depois do batimento".
    //
    // A sonda é uma CONTAGEM, e não um casamento de chamada: `completeJob(...)`
    // tem parênteses aninhados, e a expressão `[^)]*\)` que "pega a chamada
    // inteira" para no `)` de `claimOfJob(job)` — deixando o `?.acquired_at`
    // fora do texto casado. Medido: com essa forma, a mutação que devolve os
    // desfechos ao claim passava verde. A contagem não tem esse buraco.
    const usos = fonte.match(/claimOfJob\(job\)\?\.acquired_at/g) ?? [];
    expect(
      usos,
      "`claimOfJob(job)?.acquired_at` só pode aparecer UMA vez — na semente do lease",
    ).toHaveLength(1);
    expect(fonte, "e a semente tem de ser a inicialização do lease").toMatch(
      /let lease = claimOfJob\(job\)\?\.acquired_at/,
    );

    // Controle positivo: os desfechos existem mesmo no fonte e levam `lease`.
    for (const desfecho of ["completeJob", "failJob", "cancelJob"]) {
      expect(fonte, `${desfecho} tinha de estar no fonte`).toContain(`${desfecho}(`);
    }
    expect(
      fonte.match(/, lease\)/g)?.length ?? 0,
      "os desfechos levam o lease renovado",
    ).toBeGreaterThanOrEqual(3);
  });
});
