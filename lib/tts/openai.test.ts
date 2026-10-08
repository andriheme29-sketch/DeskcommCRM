/**
 * O ADAPTADOR ABERTO — qualquer gateway que fale o `/audio/speech` da OpenAI.
 * O que se prova aqui não é "fala com o 9Router": é que o CONTRATO do protocolo
 * é respeitado (endpoint, corpo, `response_format` CBR que a duração exige) e
 * que nenhum desfecho ruim lança.
 */
import { describe, expect, it, vi } from "vitest";

import { MODELO_PADRAO_ABERTO, sintetizarComOpenAi, VOZ_PADRAO_ABERTA } from "./openai";
import { FORMATO_PADRAO } from "./tipos";

const LOG = { warn: vi.fn() };
const CONFIG = {
  chave: "sk-gateway",
  voz: "minha-voz",
  modelo: "tts-1-hd",
  formato: FORMATO_PADRAO,
  baseUrl: "https://meu-gateway.example/v1/",
};

/** 1 segundo de mp3 CBR 128 kbps = 16.000 bytes. */
const UM_SEGUNDO = new Uint8Array(16_000);

function resposta(bytes: Uint8Array, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => bytes.buffer,
    text: async () => "invalid_api_key",
  };
}

describe("sintetizarComOpenAi", () => {
  it("sem endereço próprio, recusa com motivo — o gateway é escolha da empresa", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarComOpenAi("oi", {
      config: { ...CONFIG, baseUrl: null },
      fetchImpl,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_desligado" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caminho feliz: POST {base}/audio/speech com Bearer, modelo, voz e response_format mp3", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    const r = await sintetizarComOpenAi("Olá!", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });

    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("esperava sucesso");
    expect(r.voz.duracaoMs).toBe(1_000);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // A barra final do baseUrl não duplica o caminho.
    expect(url).toBe("https://meu-gateway.example/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-gateway");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "tts-1-hd",
      input: "Olá!",
      voice: "minha-voz",
      response_format: "mp3",
    });
  });

  it("modelo e voz vazios caem no padrão do protocolo", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    await sintetizarComOpenAi("oi", {
      config: { ...CONFIG, modelo: "", voz: "" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const corpo = JSON.parse(init.body as string);
    expect(corpo.model).toBe(MODELO_PADRAO_ABERTO);
    expect(corpo.voice).toBe(VOZ_PADRAO_ABERTA);
  });

  it("HTTP de erro vira tts_falhou com o status", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO, { ok: false, status: 429 }));
    const r = await sintetizarComOpenAi("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "http_429" });
  });

  it("exceção de rede NUNCA sobe", async () => {
    const erro = new Error("dns");
    erro.name = "TypeError";
    const fetchImpl = vi.fn(async () => {
      throw erro;
    });
    const r = await sintetizarComOpenAi("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "TypeError" });
  });
});