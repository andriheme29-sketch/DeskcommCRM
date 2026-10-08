/**
 * O SINAL DE ÁUDIO DO CLIENTE — a metade "detecção" do modo de voz.
 *
 * O modo `quando_cliente_fala` e o `decidir` dependem de saber se a mensagem que
 * disparou o turno foi uma NOTA DE VOZ. O dado já existe no contexto do turno
 * (`type` só é preenchido em mensagens com mídia), então a leitura é barata e
 * aqui se prova que ela é a ÚLTIMA inbound — não qualquer uma do histórico.
 */
import { describe, expect, it } from "vitest";

import { mensagemDeAudioDoCliente } from "./inbound-turn";

const m = (direction: "inbound" | "outbound", type?: string) =>
  type === undefined ? { direction } : { direction, type };

describe("mensagemDeAudioDoCliente", () => {
  it("a última inbound é áudio → true", () => {
    expect(mensagemDeAudioDoCliente([m("inbound"), m("inbound", "audio")])).toBe(true);
  });

  it("a última inbound é texto (mesmo com áudio antes) → false", () => {
    // O turno responde à mensagem MAIS RECENTE do cliente: um áudio antigo já
    // respondido não deve reacender a voz neste turno.
    expect(
      mensagemDeAudioDoCliente([m("inbound", "audio"), m("outbound"), m("inbound")]),
    ).toBe(false);
  });

  it("só outbound, ou nada → false (não fala voz no escuro)", () => {
    expect(mensagemDeAudioDoCliente([m("outbound"), m("outbound", "audio")])).toBe(false);
    expect(mensagemDeAudioDoCliente([])).toBe(false);
  });

  it("imagem/documento são mídia, mas NÃO são áudio", () => {
    expect(mensagemDeAudioDoCliente([m("inbound", "image")])).toBe(false);
    expect(mensagemDeAudioDoCliente([m("inbound", "document")])).toBe(false);
  });
});