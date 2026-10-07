/**
 * A porta de TTS: o que ela faz quando dá certo e — o que importa mais — o que
 * ela faz quando dá errado. Nenhum desfecho ruizinho pode LANÇAR: o turno do
 * agente corre dentro da resposta ao cliente, e uma exceção aqui derrubaria a
 * mensagem inteira. Todo caso ruim volta como `{ ok: false }` e o turno degrada
 * para texto.
 */
import { describe, expect, it, vi } from "vitest";

import {
  configDaVoz,
  duracaoDoAudio,
  FORMATO_PADRAO,
  LIMITE_DE_CARACTERES,
  MODELO_PADRAO,
  sintetizarVoz,
  VOZ_PADRAO,
} from "./elevenlabs";

const LOG = { warn: vi.fn() };
const CONFIG = { chave: "sk_teste", voz: "voz-1", modelo: MODELO_PADRAO, formato: FORMATO_PADRAO };

/** 1 segundo de mp3 CBR 128 kbps = 16.000 bytes. */
const UM_SEGUNDO = new Uint8Array(16_000);

function resposta(bytes: Uint8Array, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => bytes.buffer,
    text: async () => "voice_not_found",
  };
}

describe("configDaVoz — vazio é DESLIGADO, e é o padrão do produto", () => {
  it("sem chave não há voz: instalação self-host não é obrigada a contratar TTS", () => {
    expect(configDaVoz({})).toBeNull();
    expect(configDaVoz({ ELEVENLABS_API_KEY: "   " })).toBeNull();
  });

  it("com chave, o resto vem do default do produto", () => {
    expect(configDaVoz({ ELEVENLABS_API_KEY: " sk_x " })).toEqual({
      chave: "sk_x",
      voz: VOZ_PADRAO,
      modelo: MODELO_PADRAO,
      formato: FORMATO_PADRAO,
    });
  });

  it("voz e modelo escolhidos na instalação vencem o default", () => {
    expect(
      configDaVoz({
        ELEVENLABS_API_KEY: "sk_x",
        ELEVENLABS_VOICE_ID: "minha-voz",
        ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      }),
    ).toMatchObject({ voz: "minha-voz", modelo: "eleven_multilingual_v2" });
  });
});

describe("duracaoDoAudio — a régua do tempo certo", () => {
  it("formato CBR: bytes ÷ taxa é a duração", () => {
    expect(duracaoDoAudio(16_000)).toBe(1_000);
    expect(duracaoDoAudio(8_000)).toBe(500);
    expect(duracaoDoAudio(0)).toBe(0);
    expect(duracaoDoAudio(Number.NaN)).toBe(0);
  });
});

describe("sintetizarVoz — nenhum desfecho lança", () => {
  it("desligada: devolve tts_desligado e nem toca a rede", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarVoz("oi", { config: null, fetchImpl, log: LOG });
    expect(r).toMatchObject({ ok: false, code: "tts_desligado" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("texto vazio não vira voz", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarVoz("   ", { config: CONFIG, fetchImpl, log: LOG });
    expect(r).toMatchObject({ ok: false, code: "texto_vazio" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("texto acima do teto é recusado ANTES de gastar crédito", async () => {
    const fetchImpl = vi.fn();
    const r = await sintetizarVoz("a".repeat(LIMITE_DE_CARACTERES + 1), {
      config: CONFIG,
      fetchImpl,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "texto_longo" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caminho feliz: POST com a voz, o modelo e a chave no header; devolve bytes e duração", async () => {
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO));
    const r = await sintetizarVoz("Oi, tudo bem?", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });

    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("esperava sucesso");
    expect(r.voz.mime).toBe("audio/mpeg");
    expect(r.voz.duracaoMs).toBe(1_000);
    expect(r.voz.bytes.length).toBe(16_000);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/text-to-speech/voz-1");
    expect(url).toContain(`output_format=${FORMATO_PADRAO}`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_teste");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Oi, tudo bem?",
      model_id: MODELO_PADRAO,
    });
  });

  it("HTTP de erro vira tts_falhou com o status, e o detalhe vai ao log", async () => {
    const log = { warn: vi.fn() };
    const fetchImpl = vi.fn(async () => resposta(UM_SEGUNDO, { ok: false, status: 401 }));
    const r = await sintetizarVoz("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "http_401" });
    expect(log.warn).toHaveBeenCalled();
  });

  it("corpo vazio não é voz — vira tts_falhou em vez de bolha muda", async () => {
    const fetchImpl = vi.fn(async () => resposta(new Uint8Array(0)));
    const r = await sintetizarVoz("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "corpo_vazio" });
  });

  it("timeout/DNS/TLS viram tts_falhou — a exceção NUNCA sobe", async () => {
    const erro = new Error("aborted");
    erro.name = "TimeoutError";
    const fetchImpl = vi.fn(async () => {
      throw erro;
    });
    const r = await sintetizarVoz("oi", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: LOG,
    });
    expect(r).toMatchObject({ ok: false, code: "tts_falhou", message: "TimeoutError" });
  });
});
