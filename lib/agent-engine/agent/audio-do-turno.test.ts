/**
 * O áudio do turno: onde o arquivo nasce e o que acontece quando ele NÃO nasce.
 * O segundo caso é o que protege a venda — o turno nunca fica sem resposta por
 * causa da voz, exatamente como a foto que não copia sai do envio e o texto
 * segue.
 *
 * A síntese e o upload são injetados (é o desenho do módulo): aqui não há rede,
 * não há Storage e não há crédito gasto.
 */
import { describe, expect, it, vi } from "vitest";

import { caminhoDoAudio, esperaDoAudio, prepararAudioDoTurno } from "./audio-do-turno";
import type { ResultadoDaSintese } from "@/lib/tts/elevenlabs";

const ORG = "org-1";
const CONVERSA = "conv-1";
const VOZ = {
  bytes: Buffer.from(new Uint8Array(16_000)),
  mime: "audio/mpeg",
  duracaoMs: 1_000,
};

function sinteseOk(): ResultadoDaSintese {
  return { ok: true, voz: VOZ };
}

describe("caminhoDoAudio — o mesmo desenho da conversa que a mídia usa", () => {
  it("org/conversa/voz-<carimbo> com a extensão do mime", () => {
    expect(caminhoDoAudio(ORG, CONVERSA, 123, "audio/mpeg")).toBe(`${ORG}/${CONVERSA}/voz-123.mp3`);
    expect(caminhoDoAudio(ORG, CONVERSA, 123, "audio/ogg")).toBe(`${ORG}/${CONVERSA}/voz-123.ogg`);
  });
});

describe("prepararAudioDoTurno", () => {
  it("sintetiza e sobe o arquivo para a pasta da conversa", async () => {
    const sintetizar = vi.fn(async () => sinteseOk());
    const subir = vi.fn(async () => true);

    const r = await prepararAudioDoTurno(sintetizar, subir, {
      tenantId: ORG,
      conversationId: CONVERSA,
      texto: "Oi, tudo bem?",
      agoraMs: 777,
    });

    expect(sintetizar).toHaveBeenCalledWith("Oi, tudo bem?");
    expect(subir).toHaveBeenCalledTimes(1);
    const [destino, bytes, mime] = subir.mock.calls[0] as unknown as [string, Buffer, string];
    expect(destino).toBe(`${ORG}/${CONVERSA}/voz-777.mp3`);
    expect(bytes.length).toBe(16_000);
    expect(mime).toBe("audio/mpeg");
    expect(r).toEqual({
      ok: true,
      audio: { storagePath: `${ORG}/${CONVERSA}/voz-777.mp3`, mime: "audio/mpeg", duracaoMs: 1_000 },
    });
  });

  it("síntese falhou: devolve o motivo e NÃO sobe nada (nem tenta)", async () => {
    const sintetizar = vi.fn(async (): Promise<ResultadoDaSintese> => ({
      ok: false,
      code: "tts_falhou",
      message: "http_401",
    }));
    const subir = vi.fn(async () => true);

    const r = await prepararAudioDoTurno(sintetizar, subir, {
      tenantId: ORG,
      conversationId: CONVERSA,
      texto: "oi",
    });

    expect(r).toMatchObject({ ok: false, code: "tts_falhou" });
    expect(subir).not.toHaveBeenCalled();
  });

  it("Storage recusou: a voz não vai pela metade — quem chama manda texto", async () => {
    const subir = vi.fn(async () => false);
    const r = await prepararAudioDoTurno(async () => sinteseOk(), subir, {
      tenantId: ORG,
      conversationId: CONVERSA,
      texto: "oi",
      agoraMs: 1,
    });
    expect(r).toMatchObject({ ok: false, code: "audio_nao_subiu" });
  });
});

describe("esperaDoAudio — o tempo certo é a duração do arquivo", () => {
  it("duração + jitter do canal", () => {
    expect(esperaDoAudio(4_000, () => 1_200)).toBe(5_200);
  });

  it("duração inválida não vira espera negativa — sobra só o jitter", () => {
    expect(esperaDoAudio(Number.NaN, () => 1_200)).toBe(1_200);
    expect(esperaDoAudio(-5, () => 1_200)).toBe(1_200);
  });
});
