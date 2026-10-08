/**
 * O QUE TODA VOZ TEM EM COMUM — e o que NÃO muda quando o provedor muda.
 *
 * A voz do agente nasceu presa a um provedor (ElevenLabs) porque era a única
 * integração que existia. Passou a ter dois: o ElevenLabs nativo e qualquer
 * gateway compatível com a API da OpenAI (`POST {base}/audio/speech`). O que os
 * dois dividem é este arquivo — o contrato de entrada, o de saída, o teto de
 * texto e a régua de duração. O que os separa mora em `./elevenlabs` e
 * `./openai`, cada um com o seu jeito de falar HTTP.
 *
 * ═══ DUAS REGRAS QUE VALEM PARA TODO ADAPTADOR ═══
 *
 * **Nada lança.** A síntese corre dentro do turno que responde ao cliente; uma
 * exceção aqui derrubaria a resposta inteira. Todo desfecho ruim volta como
 * `{ ok: false, code }` e quem chama degrada para texto — a mesma escolha que a
 * foto do produto que não copia faz. Perder a voz é aceitável; perder a
 * resposta, nunca.
 *
 * **A duração é MEDIDA, não perguntada.** O "tempo certo" do áudio (o
 * `recording` aceso no aparelho do cliente e a pausa antes do envio) é a
 * duração do arquivo. Nenhum dos provedores a devolve no corpo da resposta. O
 * formato que pedimos é CBR, e num CBR o tamanho em bytes dividido pela taxa É
 * a duração, com erro de milissegundos. Trocar para um formato VBR invalida
 * esta conta — por isso o formato é constante nomeada, nunca literal solto.
 */

/** Voz feminina multilíngue padrão do produto — PREMADE, existe em qualquer conta. */
export const VOZ_PADRAO = "21m00Tcm4TlvDq8ikWAM";

/** Modelo multilíngue padrão do provedor nativo; "v4" é o escolhido pela operação Hidraliso. */
export const MODELO_PADRAO = "eleven_v4";

/** CBR 44,1 kHz 128 kbps — ver a nota de duração no cabeçalho. */
export const FORMATO_PADRAO = "mp3_44100_128";
export const BITS_POR_SEGUNDO = 128_000;
export const TIMEOUT_PADRAO_MS = 20_000;

/**
 * Teto do que vai para a voz. O turno manda bolhas curtas; um texto do tamanho
 * de um roteiro inteiro é sinal de que quem chamou errou o caminho, e deixar
 * passar só queimaria crédito e minutos de síntese.
 */
export const LIMITE_DE_CARACTERES = 2_500;

/**
 * Os provedores de VOZ que o produto sabe executar. A lista que a TELA oferece
 * mora em `lib/ai/pontos/provedores.ts` (a terceira lista irmã, ao lado da do
 * Jev); este tipo é o que o ADAPTADOR executa. Um provedor que chegue até aqui
 * sem ramo correspondente falha com `provedor_desconhecido` — erro tipado, não
 * exceção. Quem casa as duas listas é `lib/tts/index.test.ts`.
 */
export type ProvedorDeVoz = "elevenlabs" | "tts-aberto";

export interface VozSintetizada {
  bytes: Buffer;
  mime: string;
  /** duração do arquivo, para a pausa humana e o indicador de gravação */
  duracaoMs: number;
}

export type ResultadoDaSintese =
  | { ok: true; voz: VozSintetizada }
  | { ok: false; code: CodigoDeFalhaDaVoz; message: string };

export type CodigoDeFalhaDaVoz =
  | "tts_desligado"
  | "texto_vazio"
  | "texto_longo"
  | "tts_falhou"
  | "provedor_desconhecido";

export interface ConfigDaVoz {
  chave: string;
  voz: string;
  modelo: string;
  formato: string;
  /**
   * Endereço próprio do provedor (gateway compatível, proxy da ElevenLabs).
   * `null`/ausente = o endereço oficial do provedor. Mora aqui, e não numa
   * variável de ambiente, pelo mesmo motivo do provedor personalizado de texto:
   * a escolha da empresa não pode depender do servidor.
   */
  baseUrl?: string | null;
}

export interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Duração do arquivo a partir do tamanho, para formato CBR. Pura. */
export function duracaoDoAudio(bytes: number, bitsPorSegundo = BITS_POR_SEGUNDO): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes * 8 * 1000) / bitsPorSegundo);
}

/**
 * O que NÃO depende do provedor: a instalação está sem voz? O texto está vazio?
 * Passou do teto? Devolve o desfecho ruim, ou `null` quando há o que sintetizar.
 *
 * Chamado pelo despachante E por cada adaptador — de propósito. O adaptador
 * sozinho continua seguro (ninguém o chama com texto de 10 mil caracteres
 * achando que vai sair barato), e o despachante recusa antes de escolher
 * adapter, sem gastar o trabalho de resolver provedor para um texto vazio.
 */
export function validarPedidoDeVoz(
  texto: string,
  config: ConfigDaVoz | null,
): { ok: false; code: CodigoDeFalhaDaVoz; message: string } | null {
  if (config === null) {
    return { ok: false, code: "tts_desligado", message: "instalação sem chave de voz configurada" };
  }
  const corpo = texto.trim();
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
  return null;
}