/**
 * A guarda de ambiguidade do publish: o MESMO número não ganha dois agentes no ar
 * sem alguém dizer que quis.
 *
 * ─── Por que esta guarda existe ────────────────────────────────────────────
 *
 * `channel_session_id` é o número de WhatsApp — recurso único. Dois agentes com
 * versão `published` apontando para ele não é configuração: é empate, e o turno
 * desempata sozinho por `priority`/`created_at` (`agente-da-conversa.ts`). Quem
 * publicou o segundo não escolheu nada e pode nem saber que o primeiro existia.
 *
 * Trocar o agente de um número é operação legítima — por isso a guarda não
 * proíbe, ela EXIGE confirmação explícita (`confirmar_troca_numero`). O teste
 * prova as duas pontas, e prova também o caso em que NÃO se pergunta nada: o
 * rascunho sem número escolhido (estado normal, migration 0239).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishAgentVersion } from "@/lib/ai/agents/publish";

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/agents/publish", () => ({ publishAgentVersion: vi.fn() }));
// A sessão de verdade passa pelo `createClient()` do Next, que este teste isolado
// não tem. O que este arquivo prova é a guarda, não o auth.
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(async () => ({
    ok: true,
    organizationId: "22222222-2222-4222-8222-222222222222",
    actor: { type: "user", id: "11111111-1111-4111-8111-111111111111" },
    apiTokenId: null,
    supabase: {},
    idioma: "pt-BR",
    via: "session",
  })),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const SESSAO = "55555555-5555-4555-8555-555555555555";

/** Quantas vezes a rota perguntou pelo ocupante do número. */
let consultasDeOcupante = 0;

function adminStub(opts: { channelSessionId: string | null; ocupantes: { id: string }[] }) {
  return {
    from: (table: string) => {
      if (table === "ai_agent_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: VERSION,
                    agent_id: AGENT,
                    organization_id: ORG,
                    tool_ids: [],
                    status: "draft",
                    channel_session_id: opts.channelSessionId,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ai_agents") {
        consultasDeOcupante += 1;
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          is: () => chain,
          then: (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: opts.ocupantes, error: null }).then(ok),
        };
        return chain;
      }
      // event_log — fire-and-forget.
      return {
        insert: () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }),
      };
    },
  };
}

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: AGENT }) };

describe("POST .../publish — o número já ocupado exige confirmação", () => {
  beforeEach(() => {
    // `mockResolvedValue` re-arma o retorno mas NÃO zera o histórico de chamadas:
    // sem isto, `toHaveBeenCalledTimes(1)` do teste seguinte conta as chamadas dos
    // anteriores. Limpar antes de re-armar é a ordem que importa.
    vi.clearAllMocks();
    consultasDeOcupante = 0;
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    vi.mocked(publishAgentVersion).mockResolvedValue({
      ok: true,
      agent_id: AGENT,
      version_id: VERSION,
      previous_version_id: null,
      published_at: "2026-10-10T00:00:00.000Z",
    });
  });

  it("sem a flag, um segundo agente no mesmo número é recusado com 422", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ channelSessionId: SESSAO, ocupantes: [{ id: "outro-agente" }] }) as never,
    );

    const { POST } = await import("./route");
    const res = await POST(req({ version_id: VERSION }), ctx);
    const body = (await res.json()) as { error?: { code?: string } };

    expect(res.status).toBe(422);
    expect(body.error?.code).toBe("channel_session_already_taken");
    // A recusa acontece ANTES de publicar: nada foi trocado no banco.
    expect(publishAgentVersion).not.toHaveBeenCalled();
  });

  it("com `confirmar_troca_numero: true`, a troca passa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ channelSessionId: SESSAO, ocupantes: [{ id: "outro-agente" }] }) as never,
    );

    const { POST } = await import("./route");
    const res = await POST(req({ version_id: VERSION, confirmar_troca_numero: true }), ctx);
    const body = (await res.json()) as { data?: { version_id?: string } };

    expect(res.status).toBe(200);
    expect(body.data?.version_id).toBe(VERSION);
    expect(publishAgentVersion).toHaveBeenCalledTimes(1);
    // Confirmada a troca, nem se pergunta quem ocupava: a resposta já é sim.
    expect(consultasDeOcupante).toBe(0);
  });

  it("número livre publica sem perguntar nada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ channelSessionId: SESSAO, ocupantes: [] }) as never,
    );

    const { POST } = await import("./route");
    const res = await POST(req({ version_id: VERSION }), ctx);

    expect(res.status).toBe(200);
    expect(publishAgentVersion).toHaveBeenCalledTimes(1);
  });

  it("rascunho sem número escolhido (0239) não dispara a guarda", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ channelSessionId: null, ocupantes: [{ id: "outro-agente" }] }) as never,
    );

    const { POST } = await import("./route");
    const res = await POST(req({ version_id: VERSION }), ctx);

    expect(res.status).toBe(200);
    expect(consultasDeOcupante).toBe(0);
  });
});