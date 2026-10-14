import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  baterNoJob,
  cancelJob,
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  reapExpiredJobs,
} from "@/lib/agent-engine/queue/queue";

/**
 * O LEASE NÃO PODE VENCER ENQUANTO O TURNO RODA — o batimento (issue da fila
 * que perde turnos, medido nesta VPS em 2026-10-14).
 *
 * `claimJobs` grava `locked_at = now()` UMA vez e nunca mais toca na coluna. O
 * reaper (`reapExpiredJobs`) trata todo 'running' mais velho que
 * `QUEUE_VISIBILITY_TIMEOUT_MS` como órfão: devolve a 'pending' e outro worker
 * o re-claima. Quando o PRIMEIRO worker termina, o `completeJob` dele perde a
 * corrida (`locked_by` + `locked_at` do claim) e **recusa commitar** — o turno
 * inteiro (chamada do agente, envio, checkpoint) é descartado e refeito.
 *
 * Medido nos logs do worker: 256 turnos concluídos, mediana 78 s, p90 228 s,
 * **máx 584 s**, contra um lease de 600 s. A cauda da distribuição vivia a
 * dezesseis segundos do penhasco — e 24 jobs morreram ali (`last_error` =
 * 'visibility timeout excedido (worker morto?)') sem worker nenhum ter morrido.
 *
 * ## O que este arquivo prova, e por que ele é de BANCO
 *
 * O conserto vive em SQL (`baterNoJob` reescreve `locked_at` sob a MESMA guarda
 * de dono dos desfechos) e o defeito é uma CORRIDA entre o reaper e o worker —
 * nada disso é observável fora de um Postgres de verdade, com `now()` de
 * servidor e dois `update` concorrentes na mesma linha. Um teste que chamasse
 * `baterNoJob` contra um mock provaria que a função existe, não que o lease
 * sobrevive.
 *
 * O relógio aqui é REAL e o lease é curto (250 ms) de propósito: encurtar o
 * lease é o único jeito de observar o vencimento sem esperar 10 minutos, e um
 * lease curto é o pior caso do batimento (o intervalo tem piso de 1 s, então o
 * batimento NÃO cabe dentro dele — quem segura o job é o teto, não o ritmo).
 *
 * Roda contra o Postgres efêmero do `scripts/test-db.sh`, com o `baseline.sql`
 * aplicado — o mesmo arquivo que o kit self-host instala.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "0be7a70a-2580-4000-8000-000000000a11";
const CONTATO = "0be7a70a-2580-4000-8000-000000000a12";

/** Lease curto o bastante para o vencimento caber num teste, e real o bastante
 *  para o batimento ter de acontecer no meio dele. */
const LEASE_MS = 250;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lockedAt(jobId: string): Promise<string | null> {
  const { rows } = await pool.query<{ locked_at: string | null }>(
    "select locked_at::text as locked_at from job_queue where id = $1",
    [jobId],
  );
  return rows[0]?.locked_at ?? null;
}

async function statusDe(jobId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    "select status from job_queue where id = $1",
    [jobId],
  );
  return rows[0]!.status;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-lease-batimento', 'Org Lease Batimento LTDA', 'Org Lease Batimento')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead do Lease', '+5511900000000')
     on conflict (id) do nothing`,
    [CONTATO, ORG],
  );
});

afterEach(async () => {
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
});

afterAll(async () => {
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where id = $1", [CONTATO]);
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("baterNoJob: o lease de um turno que ainda roda", () => {
  it("sem batimento o reaper devolve o job VIVO — é o defeito, e ele é o controle", async () => {
    // CONTROLE. Este é o comportamento de antes do conserto e ele PRECISA
    // continuar existindo: é o que o batimento evita. Se este caso ficar verde
    // só porque o reaper parou de funcionar, o caso seguinte vira decoração —
    // um teste que passa porque o instrumento morreu.
    const { job } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
    await claimJobs(pool, { workerId: "w-sem-batimento", maxConcurrency: 8 });
    const doClaim = await lockedAt(job.id);

    await dormir(LEASE_MS + 120);
    const { revived } = await reapExpiredJobs(pool, { visibilityTimeoutMs: LEASE_MS });

    expect(revived, "o reaper tinha de alcançar o job parado").toBe(1);
    expect(await statusDe(job.id)).toBe("pending");
    expect(await lockedAt(job.id)).toBeNull();

    // E o desfecho do primeiro worker é RECUSADO: é a perda do turno inteiro.
    await expect(
      completeJob(pool, job.id, "w-sem-batimento", undefined, doClaim ?? undefined),
    ).rejects.toThrow(/lease do job .* perdido no complete/);
  });

  it("com batimento o mesmo job VIVO sobrevive ao reaper e conclui", async () => {
    // O CONSERTO, na mesma régua do controle acima: mesma espera, mesmo lease,
    // mesma chamada de reaper — a única diferença é o batimento no meio.
    const { job } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
    await claimJobs(pool, { workerId: "w-com-batimento", maxConcurrency: 8 });
    let lease = await lockedAt(job.id);

    await dormir(Math.floor(LEASE_MS / 2));
    // O worker de produção guarda o `locked_at` NOVO devolvido aqui e o usa nos
    // desfechos — nunca o do claim.
    const renovado = await baterNoJob(pool, job.id, "w-com-batimento", lease ?? undefined);
    expect(renovado, "o batimento tinha de gravar").not.toBeNull();
    expect(renovado).not.toBe(lease);
    lease = renovado;

    await dormir(Math.floor(LEASE_MS / 2));
    const { revived, dead } = await reapExpiredJobs(pool, { visibilityTimeoutMs: LEASE_MS });

    expect(revived + dead, "o reaper não podia alcançar um job que acabou de dar sinal").toBe(0);
    expect(await statusDe(job.id)).toBe("running");

    // E o desfecho commita com o lease RENOVADO.
    await completeJob(pool, job.id, "w-com-batimento", undefined, lease ?? undefined);
    expect(await statusDe(job.id)).toBe("done");
  });

  it("o desfecho com o locked_at DO CLAIM é recusado depois do batimento", async () => {
    // A armadilha que o `main.ts` tem de respeitar: passar `claim_acquired_at`
    // para o `completeJob` depois de já ter batido faz o desfecho perder o
    // lease do PRÓPRIO worker — e o turno é descartado com o trabalho feito.
    // Travar isto aqui é o que impede a "simplificação" de voltar ao
    // `claimOfJob(job)?.acquired_at` em todos os call sites.
    const { job } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
    const [claimado] = await claimJobs(pool, { workerId: "w-armadilha", maxConcurrency: 8 });
    const doClaim = claimado!.claim_acquired_at;

    const renovado = await baterNoJob(pool, job.id, "w-armadilha", doClaim);
    expect(renovado).not.toBe(doClaim);

    await expect(completeJob(pool, job.id, "w-armadilha", undefined, doClaim)).rejects.toThrow(
      /lease do job .* perdido no complete/,
    );
    expect(await statusDe(job.id), "a recusa não pode sujar o estado do job").toBe("running");

    // O caminho certo continua valendo — a recusa acima não deixou a linha presa.
    await completeJob(pool, job.id, "w-armadilha", undefined, renovado ?? undefined);
    expect(await statusDe(job.id)).toBe("done");
  });

  it("o batimento não rouba o lease de OUTRO worker (devolve null e não escreve)", async () => {
    // O reaper devolveu o job e outro worker o pegou. O primeiro worker ainda
    // está rodando e vai bater: sob a guarda errada ele reescreveria o
    // `locked_at` do SEGUNDO worker, e o desfecho do segundo perderia a corrida
    // contra um batimento fantasma. Devolver `null` é o sinal para parar.
    const { job } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
    await claimJobs(pool, { workerId: "w-primeiro", maxConcurrency: 8 });
    const doPrimeiro = await lockedAt(job.id);

    // O reaper devolve o job (worker considerado morto) e o segundo o pega.
    await pool.query(
      "update job_queue set status='pending', locked_by=null, locked_at=null where id = $1",
      [job.id],
    );
    const [doSegundo] = await claimJobs(pool, { workerId: "w-segundo", maxConcurrency: 8 });
    expect(doSegundo!.id).toBe(job.id);
    const lockedDoSegundo = await lockedAt(job.id);

    const recusado = await baterNoJob(pool, job.id, "w-primeiro", doPrimeiro ?? undefined);
    expect(recusado, "o batimento do primeiro worker tinha de ser recusado").toBeNull();
    expect(await lockedAt(job.id), "e não podia ter tocado no locked_at do segundo").toBe(
      lockedDoSegundo,
    );

    // O dono de verdade continua batendo e concluindo normalmente.
    const renovado = await baterNoJob(pool, job.id, "w-segundo", lockedDoSegundo ?? undefined);
    expect(renovado).not.toBeNull();
    await completeJob(pool, job.id, "w-segundo", undefined, renovado ?? undefined);
    expect(await statusDe(job.id)).toBe("done");
  });

  it("só bate em job 'running' — depois do desfecho a guarda fecha", async () => {
    // Os três desfechos terminalizam o job; em todos eles `locked_by` vira null
    // (ou outro dono). Um intervalo de batimento que escapasse do `finally`
    // reescreveria `locked_at` de uma linha já concluída e, num job `dead`,
    // esconderia o motivo da morte no painel.
    const { job } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
    const [claimado] = await claimJobs(pool, { workerId: "w-fim", maxConcurrency: 8 });
    const lease = claimado!.claim_acquired_at;

    await completeJob(pool, job.id, "w-fim", undefined, lease);
    expect(await baterNoJob(pool, job.id, "w-fim", lease)).toBeNull();

    // O mesmo para os outros dois desfechos, cada um no seu job.
    for (const desfecho of ["fail", "cancel"] as const) {
      const { job: outro } = await enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTATO });
      const [c] = await claimJobs(pool, { workerId: "w-fim", maxConcurrency: 8 });
      const leaseOutro = c!.claim_acquired_at;
      if (desfecho === "fail") {
        await pool.query("update job_queue set attempts = max_attempts - 1 where id = $1", [
          outro.id,
        ]);
        await failJob(pool, outro.id, "w-fim", new Error("falha para teste"), leaseOutro);
      } else {
        await cancelJob(pool, outro.id, "w-fim", "veto de negócio", leaseOutro);
      }
      expect(await statusDe(outro.id), desfecho).not.toBe("running");
      expect(await baterNoJob(pool, outro.id, "w-fim", leaseOutro), desfecho).toBeNull();
    }
  });
});
