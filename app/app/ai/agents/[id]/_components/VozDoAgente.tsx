"use client";
/**
 * A VOZ DESTE AGENTE — escolher o provedor e QUANDO ele fala em vez de escrever.
 *
 * Duas perguntas, numa tela só, porque uma não faz sentido sem a outra: de onde
 * vem a voz (provedor + chave + voz + modelo) e em que momento ela sai (o MODO).
 * O modo é o que o dono pediu como "um jeito inteligente de saber a hora": um
 * `decidir` determinístico, que não depende do modelo lembrar.
 *
 * Mora aqui, e não no painel de Provedores, pela mesma razão do `ModelPicker`:
 * quem decide o modelo da conversa é o AGENTE PUBLICADO, e a voz segue a mesma
 * precedência (`lib/tts/resolver.ts`). Uma escolha por agente que vivesse no
 * painel da empresa seria uma segunda fonte para o mesmo fato.
 */
import * as React from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { PROVEDORES_DE_VOZ } from "@/lib/ai/pontos/provedores";
import { MODOS_DE_VOZ, type ModoDeVoz } from "@/lib/agent-engine/agent/voz-do-turno";

/** Rótulo de cada modo, como o dono vê. */
const ROTULO_DO_MODO: Record<ModoDeVoz, string> = {
  nunca: "Nunca mandar áudio",
  quando_cliente_fala: "Só quando o cliente mandar áudio",
  sempre: "Sempre responder em voz",
  decidir: "Decidir sozinho (recomendado)",
};

const EXPLICACAO_DO_MODO: Record<string, string> = {
  "": "Como antes: o agente fala em voz quando o próprio modelo decide, pelo que estiver escrito no prompt.",
  nunca: "O agente nunca manda nota de voz. Texto sempre — inclusive se o prompt pedir áudio.",
  quando_cliente_fala:
    "O agente responde em voz só quando o cliente mandou uma nota de voz. Texto no resto.",
  sempre: "O agente responde em voz sempre que o texto couber bem falado. Link, código de pedido e listas continuam saindo em texto.",
  decidir:
    "O agente manda voz quando o cliente mandou áudio, pediu voz, ou o prompt pedir — e texto no resto. É o modo que equilibra experiência e custo.",
};

export interface VozDoAgenteValor {
  voice_mode: string;
  voice_provider: string;
  voice_credential_id: string;
  voice_id: string;
  voice_model: string;
}

interface Props extends VozDoAgenteValor {
  credentials: CredentialRow[];
  onChange: (patch: Partial<VozDoAgenteValor>) => void;
  disabled?: boolean;
}

export function VozDoAgente({
  voice_mode,
  voice_provider,
  voice_credential_id,
  voice_id,
  voice_model,
  credentials,
  onChange,
  disabled,
}: Props) {
  const t = useT();
  // Só credenciais de VOZ: uma chave de texto não fala. Derivado da lista de
  // provedores de voz (`PROVEDORES_DE_VOZ`), nunca de um literal.
  const idsDeVoz = React.useMemo(
    () => new Set<string>(PROVEDORES_DE_VOZ.map((p) => p.id)),
    [],
  );
  const credenciaisDeVoz = credentials.filter((c) => idsDeVoz.has(c.provider));

  return (
    <div className="space-y-3" data-testid="voz-do-agente">
      <div className="space-y-1">
        <Label htmlFor="voice_mode">{t("Voz do agente")}</Label>
        <Select
          value={voice_mode === "" ? "__padrao__" : voice_mode}
          onValueChange={(v) => onChange({ voice_mode: v === "__padrao__" ? "" : v })}
          disabled={disabled}
        >
          <SelectTrigger id="voice_mode" data-testid="voice-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__padrao__">
              {t("Como antes (o prompt decide)")}
            </SelectItem>
            {MODOS_DE_VOZ.map((m) => (
              <SelectItem key={m} value={m}>
                {t(ROTULO_DO_MODO[m])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t(EXPLICACAO_DO_MODO[voice_mode] ?? "")}</p>
      </div>

      {/* A escolha de provedor só faz sentido quando há voz: sem modo, o campo
          seria uma promessa que nada usa. */}
      {voice_mode !== "" && voice_mode !== "nunca" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="voice_provider">{t("Provedor de voz")}</Label>
              <Select
                value={voice_provider === "" ? "__nenhum__" : voice_provider}
                onValueChange={(v) =>
                  onChange({
                    voice_provider: v === "__nenhum__" ? "" : v,
                    // Trocar de provedor invalida a chave escolhida: uma chave da
                    // ElevenLabs não fala num gateway compatível.
                    voice_credential_id: "",
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger id="voice_provider" data-testid="voice-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum__">
                    {t("Automático (a chave de voz da empresa)")}
                  </SelectItem>
                  {PROVEDORES_DE_VOZ.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="voice_credential_id">{t("Chave de voz")}</Label>
              <Select
                value={voice_credential_id === "" ? "__auto__" : voice_credential_id}
                onValueChange={(v) => onChange({ voice_credential_id: v === "__auto__" ? "" : v })}
                disabled={disabled}
              >
                <SelectTrigger id="voice_credential_id" data-testid="voice-credential">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">{t("Automático")}</SelectItem>
                  {credenciaisDeVoz.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label} · ...{c.api_key_last4 ?? "????"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="voice_id">{t("Voz (opcional)")}</Label>
              <Input
                id="voice_id"
                value={voice_id}
                onChange={(e) => onChange({ voice_id: e.target.value })}
                placeholder={t("vazio = voz padrão do provedor")}
                disabled={disabled}
                data-testid="voice-id"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="voice_model">{t("Modelo de voz (opcional)")}</Label>
              <Input
                id="voice_model"
                value={voice_model}
                onChange={(e) => onChange({ voice_model: e.target.value })}
                placeholder={t("vazio = modelo padrão do provedor")}
                disabled={disabled}
                data-testid="voice-model"
              />
            </div>
          </div>

          {credenciaisDeVoz.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <Link
                href="/app/ai/credentials"
                className="font-medium text-foreground underline underline-offset-4"
              >
                {t("Cadastre uma chave de voz")}
              </Link>{" "}
              {t(
                "em IA › Credenciais para o agente poder falar. Sem chave, a resposta sai em texto como sempre.",
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}