/**
 * `send_message` com `video_codigo` manda o vídeo de marca do catálogo PELA
 * CADEIA `before_send` (migration 0613).
 *
 * Molde de `send-message-manda-foto-do-produto.test.ts`: a lógica mora em
 * `agent/videos-do-catalogo.ts` e é testada lá por comportamento; o que este
 * arquivo prende é a FIAÇÃO dentro do `execute` (closure do turno sem ponto de
 * injeção barato): o vídeo só pode sair de DENTRO do `send` do guardrail — por
 * fora, pularia opt-out, LGPD e o ritmo anti-ban.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_TOOL_DEFS } from "@/lib/agent-engine/agent/inbound-turn";

const FONTE = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
const corpoDoSend = (() => {
  const i = FONTE.indexOf("send_message: tool({");
  const j = FONTE.indexOf("update_lead_state: tool({", i);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return FONTE.slice(i, j);
})();

describe("send_message leva o vídeo do catálogo", () => {
  it("o modelo enxerga o campo video_codigo, opcional", () => {
    const schema = AGENT_TOOL_DEFS.send_message.inputSchema;
    expect(schema.safeParse({ body: "oi" }).success).toBe(true);
    expect(schema.safeParse({ body: "oi", video_codigo: "depoimento" }).data).toEqual({
      body: "oi",
      video_codigo: "depoimento",
    });
  });

  it("o vídeo é preparado ANTES da cadeia (fora do lock) e o código errado volta sem enviar", () => {
    const prepara = corpoDoSend.indexOf("prepararVideoDoCatalogo(");
    const cadeia = corpoDoSend.indexOf("runBeforeSend(beforeSendArgs)");
    expect(prepara).toBeGreaterThan(-1);
    expect(cadeia).toBeGreaterThan(-1);
    expect(prepara).toBeLessThan(cadeia);
  });

  it("o vídeo sai de DENTRO do `send` do guardrail, com o corpo que a cadeia aprovou", () => {
    const send = corpoDoSend.slice(corpoDoSend.indexOf("send: async (finalBody: string) =>"));
    expect(send).toContain("videoDoCatalogo !== null");
    expect(send).toContain("kind: 'video'");
  });

  it("áudio, foto e vídeo são caminhos EXCLUSIVOS — combinar vira erro de ensino", () => {
    // O modelo não pode pedir duas mídias na mesma chamada: o erro volta com
    // código próprio em vez de uma delas ser descartada em silêncio.
    expect(corpoDoSend).toContain("audio_ou_midia");
    expect(corpoDoSend).toContain("foto_ou_video");
  });
});
