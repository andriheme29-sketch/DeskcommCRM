/**
 * A PORTA DE VOZ — um contrato só, três provedores atrás.
 *
 * Quem chama (o turno do agente, via `lib/agent-engine/agent/audio-do-turno.ts`)
 * nunca pergunta QUAL provedor está por baixo: entrega o texto e a config, e
 * recebe bytes + duração, ou um desfecho ruim que ele degrada para texto. É a
 * mesma forma do resto da casa — um seam só, provedores por trás.
 *
 * ═══ O QUE ESTE ARQUIVO NÃO FAZ ═══
 *
 * Não resolve credencial, não lê banco, não decide quando falar. Escolher o
 * provedor da empresa e o modo de voz é trabalho do turno (`voz-do-turno.ts`
 * decide o QUANDO; `lib/tts/resolver.ts` resolve o QUEM). Aqui é só o despacho:
 * dado `{ provedor, config }`, chame o adaptador certo.
 *
 * ═══ O QUE SOBREVIVE DA ÉPOCA DE UM PROVEDOR SÓ ═══
 *
 * `configDaVoz()` continua existindo e continua sendo o último degrau da
 * resolução: lê as `ELEVENLABS_*` do ambiente. Numa instalação que já fala por
 * env (o caso de quem ligou a voz antes desta tela existir), nada muda. Numa que
 * não tem env, devolve `null` e a voz é silêncio — nenhuma instalação self-host
 * é obrigada a contratar TTS, e o produto inteiro funciona sem esta chave.
 */
import { sintetizarComElevenLabs } from "./elevenlabs";
import { sintetizarComFish } from "./fish";
import { sintetizarComOpenAi } from "./openai";
import {
  FORMATO_PADRAO,
  MODELO_PADRAO,
  VOZ_PADRAO,
  type CodigoDeFalhaDaVoz,
  type ConfigDaVoz,
  type Log,
  type ProvedorDeVoz,
  type ResultadoDaSintese,
} from "./tipos";

export {
  BITS_POR_SEGUNDO,
  duracaoDoAudio,
  FORMATO_PADRAO,
  LIMITE_DE_CARACTERES,
  MODELO_PADRAO,
  TIMEOUT_PADRAO_MS,
  validarPedidoDeVoz,
  VOZ_PADRAO,
} from "./tipos";
export type {
  CodigoDeFalhaDaVoz,
  ConfigDaVoz,
  Log,
  ProvedorDeVoz,
  ResultadoDaSintese,
  VozSintetizada,
} from "./tipos";
export { ELEVENLABS_BASE_URL } from "./elevenlabs";
export { FISH_BASE_URL, FISH_MODELO_PADRAO } from "./fish";
export { MODELO_PADRAO_ABERTO, OPENAI_TTS_BASE_URL, VOZ_PADRAO_ABERTA } from "./openai";

const PROVEDORES_CONHECIDOS: readonly ProvedorDeVoz[] = ["elevenlabs", "tts-aberto", "fish"];

/**
 * Este id tem ADAPTADOR aqui? Pergunta diferente da que a tela faz
 * (`ehProvedorDeVoz`, em `lib/ai/pontos/provedores.ts`), e as duas precisam
 * concordar: um provedor oferecido sem adaptador seria um botão que não fala, e
 * um adaptador sem provedor oferecido é código morto. Quem casa as duas é
 * `lib/tts/index.test.ts`.
 */
export function temAdaptadorDeVoz(id: string): id is ProvedorDeVoz {
  return (PROVEDORES_CONHECIDOS as readonly string[]).includes(id);
}

/**
 * Do ambiente para a configuração, ou `null` quando a instalação não tem voz.
 *
 * Vazio = desligado, e é o padrão. A validação mora aqui e não em `lib/env.ts`
 * pelo motivo de sempre — aquele arquivo lança no import, que no Next é a
 * primeira requisição, e uma variável de FEATURE não pode ter o poder de
 * derrubar todas as telas.
 *
 * Sempre devolve o provedor NATIVO: as variáveis `ELEVENLABS_*` só existem para
 * ele. Um endpoint próprio não tem onde morar em env — ele é escolha da empresa,
 * e mora na credencial.
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
    baseUrl: null,
  };
}

/**
 * Sintetiza `texto` pelo provedor pedido. NUNCA lança: provedor desconhecido,
 * rede, HTTP não-2xx, corpo vazio e timeout viram `{ ok: false }` com o motivo
 * curto, para o log.
 */
export async function sintetizarVoz(
  texto: string,
  deps: {
    /** Qual adaptador. Ausente = o nativo (retrocompatível com quem já chamava sem isto). */
    provedor?: ProvedorDeVoz;
    config: ConfigDaVoz | null;
    fetchImpl: typeof fetch;
    log: Log;
    timeoutMs?: number;
  },
): Promise<ResultadoDaSintese> {
  const provedor = deps.provedor ?? "elevenlabs";
  if (!temAdaptadorDeVoz(provedor)) {
    deps.log.warn("voz pedida a um provedor que não existe", { provedor });
    return {
      ok: false,
      code: "provedor_desconhecido",
      message: `não há adaptador de voz para "${provedor}"`,
    };
  }
  switch (provedor) {
    case "tts-aberto":
      return sintetizarComOpenAi(texto, deps);
    case "fish":
      return sintetizarComFish(texto, deps);
    default:
      return sintetizarComElevenLabs(texto, deps);
  }
}

/** Reexport de tipo conveniente para quem só quer o código de falha. */
export type { CodigoDeFalhaDaVoz as CodigoDeFalhaDaVozExportado };