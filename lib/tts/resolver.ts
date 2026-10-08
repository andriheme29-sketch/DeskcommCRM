/**
 * DE ONDE VEM A VOZ DO TURNO — a escada, no mesmo formato da de transcrição.
 *
 * Espelha `lib/messaging/media/escada-de-transcricao.ts`, e pelo mesmo motivo:
 * degraus do mais específico ao mais genérico, cada um com a razão escrita, e um
 * `null` legítimo no fim que o turno trata como texto — nunca silêncio, nunca
 * prometer voz que não sai.
 *
 *  1. **A escolha do AGENTE** (`ai_agent_versions.voice_*`, migration 0591) — a
 *     decisão mais específica: este agente fala com esta voz. É a porta que o
 *     dono pediu ("dentro do agente escolho qual provedor de voz uso").
 *  2. **A primeira credencial de voz da organização** — quem cadastrou uma chave
 *     de voz em IA › Credenciais e não escolheu nada no agente. Desempate pela
 *     mais antiga (determinístico), como `resolverChaveOpenAiDaVoz` faz.
 *  3. **O ambiente da instalação** (`ELEVENLABS_*`) — o comportamento de ANTES
 *     desta tela existir. Quem já ligou a voz por env não muda nada.
 *  4. **Nada** — o turno trata `enviar_como_audio` como texto.
 *
 * ═══ NUNCA LANÇA ═══
 *
 * Credencial inexistente, inativa, não validada ou de outra organização vira
 * DEGRAU ABAIXO, com o motivo no log — a mesma postura do resolvedor de
 * branding e da escada de transcrição. Um turno não pode morrer porque alguém
 * apagou uma chave; ele fala em texto.
 *
 * ═══ O `anuncio` ═══
 *
 * Cada decisão devolve, além da config, o par (provedor, modelo/voz) do degrau —
 * é o que a tela de Provedores anuncia, para o painel dizer o MESMO que o motor
 * decide (o eixo catálogo × preço que este repo já viu divergir).
 */
import { loadCredential, CredentialUnavailableError } from "@/lib/ai/credentials";
import { ehProvedorDeVoz, IDS_DE_PROVEDOR_DE_VOZ } from "@/lib/ai/pontos/provedores";
import { createAdminClient } from "@/lib/supabase/admin";

import { configDaVoz, type ConfigDaVoz, type ProvedorDeVoz } from "./index";
import { FORMATO_PADRAO } from "./tipos";

export type OrigemDaVoz = "agente" | "organizacao" | "instalacao" | "nada";

export interface EscolhaDeVozDoAgente {
  provider: string | null;
  credentialId: string | null;
  voiceId: string | null;
  voiceModel: string | null;
}

export interface VozResolvida {
  provedor: ProvedorDeVoz | null;
  config: ConfigDaVoz | null;
  origem: OrigemDaVoz;
  /** Provedor/modelo do degrau, para a tela anunciar o mesmo que o motor decide. */
  anuncio: { provider: string; modelId: string | null } | null;
  /** Por que este degrau — frase curta, para o log e para o painel. */
  motivo: string;
}

interface Log {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Molde de credencial de voz: provedor e endereço, já decifrados. */
interface CredencialDeVoz {
  provider: ProvedorDeVoz;
  apiKey: string;
  baseUrl: string | null;
}

/**
 * Decifra uma credencial e a devolve no formato de voz, ou `null` com o motivo
 * no log. Nunca lança — a exceção de `loadCredential` vira ausência.
 */
async function credencialDeVoz(
  id: string,
  organizationId: string,
  log: Log,
): Promise<CredencialDeVoz | null> {
  try {
    const c = await loadCredential(id, organizationId);
    if (!ehProvedorDeVoz(c.provider)) {
      log.warn("credencial de voz aponta para provedor que não fala", { provider: c.provider });
      return null;
    }
    // O guarda acima garante o id; o `as` é só para o compilador, porque
    // `ehProvedorDeVoz` devolve boolean e o tipo `ProvedorDeVoz` mora no módulo
    // de TTS. As duas listas são a mesma, provado em `lib/tts/index.test.ts`.
    return { provider: c.provider as ProvedorDeVoz, apiKey: c.apiKey, baseUrl: c.baseUrl };
  } catch (err) {
    // Motivo CURTO — nunca a chave, nunca o corpo do provedor.
    const motivo = err instanceof CredentialUnavailableError ? err.reason : "erro";
    log.warn("credencial de voz indisponível — caindo para o degrau seguinte", { motivo });
    return null;
  }
}

/**
 * A primeira credencial de VOZ da organização, ativa e validada, pela mais
 * antiga. `null` = a organização não cadastrou nenhuma.
 *
 * A lista de provedores de voz vem de `IDS_DE_PROVEDOR_DE_VOZ` (vocabulário
 * único): acrescentar um provedor novo não exige mexer nesta consulta.
 */
async function primeiraCredencialDeVoz(
  organizationId: string,
  log: Log,
): Promise<CredencialDeVoz | null> {
  const { data, error } = await createAdminClient()
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", organizationId)
    .in("provider", IDS_DE_PROVEDOR_DE_VOZ as readonly string[])
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error) log.warn("leitura de credencial de voz falhou — sem voz na organização", {
      detalhe: error.message.slice(0, 120),
    });
    return null;
  }
  return credencialDeVoz(data.id as string, organizationId, log);
}

/**
 * Resolve a voz do turno. `escolha` é o que a versão do agente declarou;
 * `ambiente` são as `ELEVENLABS_*` da instalação (o último degrau). Nunca lança.
 */
export async function resolverVozDoTurno(
  input: {
    organizationId: string;
    escolha: EscolhaDeVozDoAgente | null;
    ambiente: { ELEVENLABS_API_KEY: string; ELEVENLABS_VOICE_ID: string; ELEVENLABS_MODEL_ID: string };
  },
  log: Log,
): Promise<VozResolvida> {
  const escolha = input.escolha;

  // Degrau 1 — a escolha do AGENTE.
  if (escolha?.credentialId) {
    const cred = await credencialDeVoz(escolha.credentialId, input.organizationId, log);
    if (cred !== null) {
      return {
        provedor: cred.provider,
        config: {
          chave: cred.apiKey,
          voz: escolha.voiceId?.trim() || "",
          modelo: escolha.voiceModel?.trim() || "",
          formato: FORMATO_PADRAO,
          baseUrl: cred.baseUrl,
        },
        origem: "agente",
        anuncio: { provider: cred.provider, modelId: escolha.voiceModel ?? escolha.voiceId ?? null },
        motivo: "a voz escolhida na versão publicada deste agente",
      };
    }
    // A credencial do agente caiu: segue a escada. O `provider` declarado sem
    // credencial utilizável NÃO basta — sem chave não há como falar.
  }

  // Degrau 2 — a primeira credencial de voz da ORGANIZAÇÃO.
  const daOrg = await primeiraCredencialDeVoz(input.organizationId, log);
  if (daOrg !== null) {
    return {
      provedor: daOrg.provider,
      config: {
        chave: daOrg.apiKey,
        // Voz/modelo do agente valem como preferência; vazios caem no padrão do
        // adaptador (`VOZ_PADRAO`/`MODELO_PADRAO`), que é o que já valia.
        voz: escolha?.voiceId?.trim() || "",
        modelo: escolha?.voiceModel?.trim() || "",
        formato: FORMATO_PADRAO,
        baseUrl: daOrg.baseUrl,
      },
      origem: "organizacao",
      anuncio: { provider: daOrg.provider, modelId: escolha?.voiceModel ?? null },
      motivo: "a credencial de voz cadastrada pela organização",
    };
  }

  // Degrau 3 — o AMBIENTE da instalação (o comportamento de antes desta tela).
  const daInstalacao = configDaVoz(input.ambiente);
  if (daInstalacao !== null) {
    return {
      provedor: "elevenlabs",
      config: daInstalacao,
      origem: "instalacao",
      anuncio: { provider: "elevenlabs", modelId: daInstalacao.modelo },
      motivo: "a chave de voz da instalação (ELEVENLABS_API_KEY)",
    };
  }

  // Degrau 4 — nada. Legítimo e explicado.
  return {
    provedor: null,
    config: null,
    origem: "nada",
    anuncio: null,
    motivo: "não há credencial de voz nesta organização nem chave da instalação",
  };
}