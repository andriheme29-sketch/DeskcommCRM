/**
 * O SEGMENTO NO GATILHO DE RETENTATIVA — a separação entre os dois produtos.
 *
 * ═══ O DEFEITO QUE ESTE TESTE CONGELA ══════════════════════════════════════
 *
 * A instalação roda DOIS produtos separados, cada um com funil, remarketing e
 * agente próprios: Fignar (Dr. Carlos) e Hidraliso (Kenia). A marca vive em
 * `contacts.tags` (`fignar` / `hidraliso`), e é por ela que os outros seis fluxos
 * da organização se separam.
 *
 * O `agente_sem_resposta` era o ÚNICO gatilho sem `segments`: o schema não
 * aceitava a chave e o sweep forçava `[]`, que DESARMA o filtro por marca em
 * `loadSilentContactIds`. Medido em produção: 19 contatos do Fignar inscritos
 * também na retentativa da Kenia, e um cliente do Dr. Carlos recebendo 6
 * mensagens de follow-up de DOIS produtos diferentes — cada fluxo contando as
 * suas próprias "2 tentativas". O dono via "está chamando três vezes".
 *
 * ⚠️ Sem este teste, a chave pode sumir do schema outra vez e o defeito volta
 * calado: nada falha, o filtro só deixa de cortar, e o sintoma aparece no
 * WhatsApp do cliente.
 */
import { describe, expect, it } from "vitest";

import { triggerConfigSchema } from "./api-schemas";

/** Um gatilho de retentativa como o da tela: espera de 3h. */
function retentativa(segments?: string[]) {
  return {
    kind: "agente_sem_resposta" as const,
    params: { threshold_minutes: 180, ...(segments ? { segments } : {}) },
    cancel_on_reply: true,
  };
}

describe("gatilho agente_sem_resposta — o segmento separa os produtos", () => {
  it("ACEITA `segments` — era o único gatilho sem a chave, e sem ela o filtro por marca desarmava", () => {
    const r = triggerConfigSchema.safeParse(retentativa(["fignar"]));
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "agente_sem_resposta") {
      expect(r.data.params.segments).toEqual(["fignar"]);
    }
  });

  it("aceita mais de uma marca — um fluxo que sirva dois produtos", () => {
    const r = triggerConfigSchema.safeParse(retentativa(["fignar", "hidraliso"]));
    expect(r.success).toBe(true);
  });

  it("continua aceitando SEM `segments` (retrocompatível) — os fluxos que já existem não quebram", () => {
    const r = triggerConfigSchema.safeParse(retentativa());
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "agente_sem_resposta") {
      expect(r.data.params.segments).toBeUndefined();
    }
  });

  it("o `threshold_minutes` continua obrigatório e dentro da faixa (o \"3h\")", () => {
    expect(
      triggerConfigSchema.safeParse({
        kind: "agente_sem_resposta",
        params: { segments: ["fignar"] },
        cancel_on_reply: true,
      }).success,
    ).toBe(false);
    expect(
      triggerConfigSchema.safeParse({
        kind: "agente_sem_resposta",
        params: { threshold_minutes: 1, segments: ["fignar"] },
        cancel_on_reply: true,
      }).success,
    ).toBe(false);
  });

  it("recusa chave desconhecida em params — `strictObject`, como os irmãos", () => {
    const r = triggerConfigSchema.safeParse({
      kind: "agente_sem_resposta",
      params: { threshold_minutes: 180, segmento: "fignar" },
      cancel_on_reply: true,
    });
    expect(r.success).toBe(false);
  });
});

/**
 * A MESMA lógica de filtro do sweep (`loadSilentContactIds`), replicada aqui
 * porque é ela que decide o desfecho no cliente: `segments` vazio = todos passam.
 */
function passaPeloFiltro(tags: string[], segments: string[]): boolean {
  return segments.length === 0 || segments.some((s) => tags.includes(s));
}

describe("o filtro por marca — quem cada retentativa pode inscrever", () => {
  const KENIA = ["hidraliso"];
  const CARLOS = ["fignar"];

  it("retentativa da Kenia NÃO toca em lead do Fignar — era exatamente o defeito", () => {
    expect(passaPeloFiltro(["fignar"], KENIA)).toBe(false);
    expect(passaPeloFiltro(["fignar", "usa-medicacao-prescrita"], KENIA)).toBe(false);
  });

  it("retentativa do Dr. Carlos NÃO toca em lead da Hidraliso", () => {
    expect(passaPeloFiltro(["hidraliso"], CARLOS)).toBe(false);
    expect(passaPeloFiltro(["hidraliso", "hidra"], CARLOS)).toBe(false);
  });

  it("cada um inscreve o SEU público", () => {
    expect(passaPeloFiltro(["fignar"], CARLOS)).toBe(true);
    expect(passaPeloFiltro(["hidraliso"], KENIA)).toBe(true);
  });

  it("sem segmento o filtro desarma — o estado anterior, que causou o vazamento", () => {
    expect(passaPeloFiltro(["fignar"], [])).toBe(true);
    expect(passaPeloFiltro(["hidraliso"], [])).toBe(true);
  });

  it("contato sem tag nenhuma não entra em fluxo segmentado", () => {
    expect(passaPeloFiltro([], KENIA)).toBe(false);
    expect(passaPeloFiltro([], CARLOS)).toBe(false);
  });
});