/**
 * O ADAPTADOR NATIVO — ElevenLabs, o provedor de voz que a Hidraliso usa.
 *
 * A doutrina do módulo (nada lança, duração medida) está em `./tipos`. Aqui só
 * mora o que é DESTE provedor: o endereço, o cabeçalho `xi-api-key`, e o corpo
 * `{ text, model_id }` que ele espera.
 *
 * ═══ POR QUE O ENDEREÇO CABE AQUI ═══
 *
 * A chave de quem opera pode ser restrita, e o endpoint pode ser um proxy da
 * própria ElevenLabs (self-host, gateway corporativo). Aceitar `baseUrl` na
 * config é o que permite "elevenlabs" apontar para outro lugar sem virar um
 * provedor diferente — a mesma decisão que o provedor personalizado de texto
 * tomou (#1642): o endereço é escolha da empresa, e mora na credencial.
 */
import {
  duracaoDoAudio,
  TIMEOUT_PADRAO_MS,
  validarPedidoDeVoz,
  type ConfigDaVoz,
  type Log,
  type ResultadoDaSintese,
} from "./tipos";

/** Endereço oficial do provedor, quando a credencial não traz um próprio. */
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

export async function sintetizarComElevenLabs(
  texto: string,
  deps: {
    config: ConfigDaVoz | null;
    fetchImpl: typeof fetch;
    log: Log;
    timeoutMs?: number;
  },
): Promise<ResultadoDaSintese> {
  const ruim = validarPedidoDeVoz(texto, deps.config);
  if (ruim !== null) return ruim;
  // Depois do guarda, `config` é não-nulo — o `!` é seguro e evita um if a mais.
  const config = deps.config as ConfigDaVoz;
  const corpo = texto.trim();
  const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "") || ELEVENLABS_BASE_URL;

  const url =
    `${base}/text-to-speech/${encodeURIComponent(config.voz)}` +
    `?output_format=${encodeURIComponent(config.formato)}`;

  try {
    const res = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.chave,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: corpo,
        model_id: config.modelo,
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_PADRAO_MS),
    });

    if (!res.ok) {
      // O corpo do erro do provedor é curto e útil ("voice_not_found"); o teto
      // evita despejar página de proxy no log.
      const detalhe = (await res.text().catch(() => "")).slice(0, 200);
      deps.log.warn("síntese de voz recusada pelo provedor", { http: res.status, detalhe });
      return { ok: false, code: "tts_falhou", message: `http_${res.status}` };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      deps.log.warn("síntese de voz devolveu corpo vazio");
      return { ok: false, code: "tts_falhou", message: "corpo_vazio" };
    }

    return {
      ok: true,
      voz: {
        bytes,
        mime: "audio/mpeg",
        duracaoMs: duracaoDoAudio(bytes.length),
      },
    };
  } catch (err) {
    // Timeout, DNS, TLS, provedor fora do ar: tudo cai aqui de propósito.
    const motivo = err instanceof Error ? err.name : "erro_desconhecido";
    deps.log.warn("síntese de voz falhou", { motivo });
    return { ok: false, code: "tts_falhou", message: motivo };
  }
}