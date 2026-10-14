/**
 * A COMPACTION AUXILIAR NÃO PODE DEIXAR O LEAD SEM RESPOSTA.
 *
 * ## O defeito que isto prende (medido nesta VPS em 2026-10-14)
 *
 * `runModelCall` LANÇA quando o provedor responde 200 com corpo que não é o JSON
 * pedido — é o `AI_APICallError: Invalid JSON response` do SDK, que não re-tenta
 * justamente porque o status foi 200. Em `compaction.ts` esse throw ficava FORA
 * do `try` que guarda só o `parse`: o `await runModelCall(...)` do flush e o da
 * compaction subiam crus até `executarTurnoDoAgente`, que os espera sem `catch`.
 *
 * O resultado medido: 6 jobs `dead` em um dia, cada um com 5 tentativas e
 * `last_error = 'Invalid JSON response'` — e, no cruzamento com `llm_calls`,
 * `turn_ok = 0` e `resp = 0`. Nenhum turno do agente completou e o lead recebeu
 * NADA. O modelo do agente estava de pé; quem derrubava era o ponto AUXILIAR,
 * que aponta para um modelo barato e diferente (a mesma armadilha que o #151 já
 * tinha consertado em três outros call sites — este é o quarto).
 *
 * ## As DUAS metades, e por que as duas estão aqui
 *
 * Degradar e propagar são propriedades opostas sobre o mesmo `catch`. Um teste
 * que só cobrisse a degradação ficaria verde com um `catch` que engole TUDO — o
 * que quebraria a escolta de orçamento (`comHandoffSeOrcamentoAcabar`), que
 * existe porque os auxiliares são os primeiros a estourar o teto e é ela quem
 * passa a conversa para uma pessoa. Então cada função auxiliar tem os dois
 * casos: falha comum do fornecedor → degrada; `LlmBudgetExceededError` → sobe.
 *
 * O par (degradar, propagar) é o MESMO de
 * `classificador-auxiliar-nao-derruba-o-turno.test.ts`: o ponto auxiliar é
 * advisório, a escolta é quem decide a passagem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { maybeCompact } from "../../lib/agent-engine/agent/compaction";
import {
  LlmBudgetExceededError,
  runModelCall,
} from "../../lib/agent-engine/edge/llm/run-model-call";
import type * as SeamDeModelo from "../../lib/agent-engine/edge/llm/run-model-call";
import type { Logger, LogFields } from "../../lib/agent-engine/obs/logger";
import type { LeadContext } from "../../lib/agent-engine/edge/crm/get-lead-context";

// `importOriginal` de propósito: a CLASSE de erro precisa ser a real, senão o
// `instanceof` do código sob teste compararia contra outro módulo e o caso de
// orçamento passaria por acidente.
vi.mock("../../lib/agent-engine/edge/llm/run-model-call", async (importOriginal) => {
  const real = await importOriginal<typeof SeamDeModelo>();
  return { ...real, runModelCall: vi.fn() };
});

const chamada = vi.mocked(runModelCall);

function logSpy(): { log: Logger; warns: Array<{ msg: string; fields?: LogFields }> } {
  const warns: Array<{ msg: string; fields?: LogFields }> = [];
  return {
    warns,
    log: {
      info: () => {},
      warn: (msg: string, fields?: LogFields) => warns.push({ msg, ...(fields ? { fields } : {}) }),
      error: () => {},
    },
  };
}

const db = {} as never;
const cfg = {} as never;
const ids = { tenantId: "org-1", leadId: "contact-1", jobId: "job-1" };

/** Um histórico acima do limiar: sem isto `maybeCompact` é no-op e nenhuma das
 *  duas chamadas auxiliares acontece — o teste mediria o caminho vazio. */
const contexto = {
  messages: [{ role: "user", content: "oi" }],
} as unknown as LeadContext;

const knobs = { triggerMessages: 1, transcriptMaxTokens: 100 };

/** Os dois pontos auxiliares falam pelo MESMO `runModelCall`, e a diferença
 *  observável é o `purpose`. O despacho por ele é o que permite falhar só um
 *  deles — falhar os dois juntos não distinguiria o flush da compaction. */
function porProposito(comportamento: (purpose: string) => unknown) {
  chamada.mockImplementation(
    (_db, _cfg, req) => comportamento((req as { purpose: string }).purpose) as never,
  );
}

beforeEach(() => {
  chamada.mockReset();
});

describe("compaction auxiliar — advisória de verdade", () => {
  it("corpo inválido do provedor na compaction degrada para null em vez de subir", async () => {
    // O defeito exato, com a mensagem exata que o SDK emite a HTTP 200.
    porProposito((purpose) => {
      if (purpose === "compaction") throw new Error("Invalid JSON response");
      return { result: { text: '{"notes": []}' } };
    });
    const { log, warns } = logSpy();

    const resumo = await maybeCompact(
      db,
      cfg,
      ids,
      { context: contexto, previousSummary: "", knobs, notesIndexMaxTokens: 1000 },
      { log },
    );

    expect(resumo).toBeNull();
    expect(warns.map((w) => w.msg)).toContain(
      "compaction: chamada do modelo auxiliar falhou — turno segue com transcript cru",
    );
  });

  it("corpo inválido do provedor no FLUSH degrada sem derrubar o turno", async () => {
    // O flush roda ANTES da compaction e é best-effort por doutrina ("o flush
    // nunca derruba o turno"). Ele derrubava: o throw do `runModelCall` saía
    // antes mesmo do `try` do parse.
    const gravadas: Array<{ headline: string }> = [];
    porProposito((purpose) => {
      if (purpose === "flush") throw new Error("Invalid JSON response");
      return {
        result: {
          text: '{"commitments":[],"objections":[],"personal_data":[],"stage":null,"rolling_summary":"ok"}',
        },
      };
    });
    const { log, warns } = logSpy();

    const resumo = await maybeCompact(
      db,
      cfg,
      ids,
      { context: contexto, previousSummary: "", knobs, notesIndexMaxTokens: 1000 },
      { log, noteSink: (n) => gravadas.push(n) },
    );

    // O flush falhou → nenhuma nota gravada; e a compaction SEGUIU.
    expect(gravadas).toHaveLength(0);
    expect(resumo?.rolling_summary).toBe("ok");
    expect(warns.map((w) => w.msg)).toContain(
      "flush pré-compaction: chamada do modelo auxiliar falhou — nenhuma nota gravada",
    );
  });

  it("estouro de orçamento SOBE — a escolta do turno é quem faz a passagem", async () => {
    porProposito(() => {
      throw new LlmBudgetExceededError();
    });
    const { log } = logSpy();

    await expect(
      maybeCompact(
        db,
        cfg,
        ids,
        { context: contexto, previousSummary: "", knobs, notesIndexMaxTokens: 1000 },
        { log },
      ),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });

  it("estouro de orçamento no FLUSH também sobe, sem chegar à compaction", async () => {
    porProposito((purpose) => {
      if (purpose === "flush") throw new LlmBudgetExceededError();
      return { result: { text: "{}" } };
    });
    const { log } = logSpy();

    await expect(
      maybeCompact(
        db,
        cfg,
        ids,
        { context: contexto, previousSummary: "", knobs, notesIndexMaxTokens: 1000 },
        { log },
      ),
    ).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });
});

describe("o warn do degrade não carrega PII", () => {
  it("a mensagem do lead nunca entra nos campos do log", async () => {
    const segredoDoLead = "meu cpf é 123.456.789-00 e moro na rua tal";
    const contextoComPii = {
      messages: [{ role: "user", content: segredoDoLead }],
    } as unknown as LeadContext;
    porProposito(() => {
      throw new Error("upstream 503");
    });
    const { log, warns } = logSpy();

    await maybeCompact(
      db,
      cfg,
      ids,
      { context: contextoComPii, previousSummary: "", knobs, notesIndexMaxTokens: 1000 },
      { log },
    );

    expect(JSON.stringify(warns)).not.toContain(segredoDoLead);
  });
});
