/**
 * VOZ DO AGENTE — a única porta de TTS do produto.
 *
 * ═══ POR QUE UM MÓDULO, E NÃO UM `fetch` NO CALL SITE ═══
 *
 * Duas razões, e a segunda é a que morde. A primeira é de doutrina: o produto
 * sobe mídia para o Storage e passa URL ao canal, nunca bytes inline — quem
 * gera o arquivo tem de ser um lugar só. A segunda é o modo de falha: a venda
 * corre no turno do agente, e um TTS que lança (chave revogada, cota estourada,
 * provedor fora do ar) derrubaria a resposta INTEIRA se a exceção subisse. Aqui
 * nada lança: todo desfecho ruim volta como `{ ok: false }` e quem chama degrada
 * para texto — a mesma escolha que `prepararFotosDoProduto` faz com a foto que
 * não copia. Perder a voz é aceitável; perder a resposta, nunca.
 *
 * ═══ A DURAÇÃO É MEDIDA, NÃO PERGUNTADA ═══
 *
 * O "tempo certo" do áudio (o `recording` aceso no aparelho do cliente) é a
 * duração do arquivo. O provedor não a devolve no corpo da resposta, e pedir
 * `/with-timestamps` traria carimbos de CARACTERE, que não são a mesma coisa. O
 * formato `mp3_44100_128` é CBR: o tamanho em bytes dividido pela taxa É a
 * duração, com erro de milissegundos. Trocar o formato para um VBR invalida
 * esta conta — por isso o formato é constante nomeada, não literal no call site.
 */

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

/** Modelo multilíngue da casa; "v4" é o escolhido pela operação Hidraliso. */
export const MODELO_PADRAO = "eleven_v4";

/**
 * Voz feminina multilíngue padrão do produto. O id é PREMADE do catálogo do
 * provedor e existe em qualquer conta — a chave de quem opera não tem
 * `voices_read`, então não há como listar o catálogo para descobrir um id.
 */
export const VOZ_PADRAO = "21m00Tcm4TlvDq8ikWAM";

/** CBR 44,1 kHz 128 kbps — ver a nota de duração no cabeçalho. */
export const FORMATO_PADRAO = "mp3_44100_128";
const BITS_POR_SEGUNDO = 128_000;
const TIMEOUT_PADRAO_MS = 20_000;

/**
 * Teto do que vai para a voz. O turno manda bolhas curtas; um texto do tamanho
 * de um roteiro inteiro é sinal de que quem chamou errou o caminho, e deixar
 * passar só queimaria crédito e minutos de síntese.
 */
export const LIMITE_DE_CARACTERES = 2_500;

export interface VozSintetizada {
  bytes: Buffer;
  mime: string;
  /** duração do arquivo, para a pausa humana e o indicador de gravação */
  duracaoMs: number;
}

export type ResultadoDaSintese =
  | { ok: true; voz: VozSintetizada }
  | { ok: false; code: CodigoDeFalhaDaVoz; message: string };

export type CodigoDeFalhaDaVoz = "tts_desligado" | "texto_vazio" | "texto_longo" | "tts_falhou";

export interface ConfigDaVoz {
  chave: string;
  voz: string;
  modelo: string;
  formato: string;
}

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Do ambiente para a configuração, ou `null` quando a instalação não tem voz.
 *
 * Vazio = desligado, e é o padrão: NENHUMA instalação self-host é obrigada a
 * contratar TTS, e o produto inteiro funciona sem esta chave. A validação mora
 * aqui e não em `lib/env.ts` pelo motivo de sempre — aquele arquivo lança no
 * import, que no Next é a primeira requisição, e uma variável de FEATURE não
 * pode ter o poder de derrubar todas as telas.
 */
export function configDaVoz(input: {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL_ID?: string;
}): ConfigDaVoz | null {
  const chave = (input.ELEVENLABS_API_KEY ?? "").trim();
  if (chave === "") return null;
  return {
    chave,
    voz: (input.ELEVENLABS_VOICE_ID ?? "").trim() || VOZ_PADRAO,
    modelo: (input.ELEVENLABS_MODEL_ID ?? "").trim() || MODELO_PADRAO,
    formato: FORMATO_PADRAO,
  };
}

/** Duração do arquivo a partir do tamanho, para formato CBR. Pura. */
export function duracaoDoAudio(bytes: number, bitsPorSegundo = BITS_POR_SEGUNDO): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes * 8 * 1000) / bitsPorSegundo);
}

/**
 * Sintetiza `texto`. NUNCA lança: rede, HTTP não-2xx, corpo vazio e timeout
 * viram `tts_falhou` com o motivo curto, para o log.
 */
export async function sintetizarVoz(
  texto: string,
  deps: {
    config: ConfigDaVoz | null;
    fetchImpl: typeof fetch;
    log: Log;
    timeoutMs?: number;
  },
): Promise<ResultadoDaSintese> {
  const corpo = texto.trim();
  if (deps.config === null) {
    return { ok: false, code: "tts_desligado", message: "instalação sem ELEVENLABS_API_KEY" };
  }
  if (corpo === "") {
    return { ok: false, code: "texto_vazio", message: "texto vazio não vira voz" };
  }
  if (corpo.length > LIMITE_DE_CARACTERES) {
    return {
      ok: false,
      code: "texto_longo",
      message: `texto com ${corpo.length} caracteres passa do teto de ${LIMITE_DE_CARACTERES}`,
    };
  }

  const url =
    `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(deps.config.voz)}` +
    `?output_format=${encodeURIComponent(deps.config.formato)}`;

  try {
    const res = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": deps.config.chave,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: corpo,
        model_id: deps.config.modelo,
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
