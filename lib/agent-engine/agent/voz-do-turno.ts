/**
 * QUANDO O AGENTE FALA EM VEZ DE ESCREVER — a decisão, e ela é DETERMINÍSTICA.
 *
 * ═══ POR QUE ISTO NÃO É (SÓ) DO MODELO ═══
 *
 * Até aqui, quem decidia mandar nota de voz era o prompt: o modelo chamava
 * `send_message` com `enviar_como_audio: true`. Isso dá três problemas que se
 * medem no negócio, não na estética:
 *
 *  1. **Não dá para DESLIGAR.** Uma conta que não quer gastar com voz não tem
 *     como dizer isso ao produto — o modelo decide sozinho, turno a turno.
 *  2. **Não dá para LIGAR.** Uma operação que quer voz sempre depende de o
 *     modelo lembrar de pedir, e ele esquece em metade dos turnos.
 *  3. **Não dá para prever o custo.** Toda nota de voz é crédito de terceiro;
 *     um comportamento que emerge do prompt não tem teto.
 *
 * Por isso a decisão sobe para uma REGRA declarada na tela do agente (o MODO),
 * e o argumento da ferramenta passa a ser um PEDIDO que a regra pode recusar —
 * nunca a única voz da decisão. O modelo continua podendo pedir voz; ele deixou
 * de ser o único juiz.
 *
 * ═══ O QUE NÃO PERTENCE AO MODELO: O QUE A VOZ ESTRAGA ═══
 *
 * Há texto que o áudio PIORA em vez de melhorar — e isto não é questão de
 * gosto, é a física do canal: link, e-mail e número de pedido existem para
 * serem COPIADOS ou TOCADOS, e ninguém copia o que ouve. O `corpoVaiBemEmVoz`
 * rebaixa esses casos para texto mesmo no modo `sempre`. É a mesma disciplina
 * dos guardrails de `before_send`: uma régua pura, com motivo auditável, em vez
 * de um pedido no prompt que o modelo às vezes ignora.
 *
 * ═══ E O QUE A VOZ NÃO ACRESCENTA: A FALA CURTA ═══
 *
 * "Entendi, qual é o seu peso e sua altura?" lida em voz alta é mais lenta de
 * consumir do que de ler, e ainda gasta crédito de voz. O `FALA_CURTA_MAX_CHARS`
 * escreve o curto e fala o longo — o roteiro do funil já é desenhado assim
 * (medido: [TEXTO] até 97 caracteres, [ÁUDIO] de 149 para cima). A régua vale
 * onde o MODO ligou a voz; pedido explícito continua vencendo.
 *
 * ═══ OS SINAIS SÃO BARATOS E JÁ ESTÃO NO TURNO ═══
 *
 * `clienteMandouAudio` e `textoDoCliente` chegam sem custo nenhum de rede — o
 * turno já sabe o que disparou ele. Nada aqui chama modelo: a decisão é pura,
 * instantânea, e testável sem dublê.
 */

/** Os quatro modos que a tela do agente oferece. */
export type ModoDeVoz = "nunca" | "sempre" | "quando_cliente_fala" | "decidir";

export const MODOS_DE_VOZ: readonly ModoDeVoz[] = [
  "nunca",
  "sempre",
  "quando_cliente_fala",
  "decidir",
];

/**
 * O estado ARMAZENADO: um dos quatro, ou `null`. `null` = "como antes desta
 * tela" — nenhum agente publicado muda de comportamento só porque a coluna
 * passou a existir, e é o default do banco. Quem nunca escolheu um modo segue
 * com o que já tinha: o modelo decide pelo prompt, e a voz sai como saía.
 *
 * É por isso que `null` NÃO cai no modo `decidir`: aquele liga a voz com o
 * pedido do MODELO também, mas passa pelo LINT (link/código viram texto). O
 * `null` preserva a saída EXATA de antes — inclusive ler um link em voz alta —,
 * porque mudar o que um agente já publicado faz sem ninguém ter pedido é o
 * defeito que este estado existe para não cometer. Quem quer o comportamento
 * inteligente escolhe `decidir` na tela.
 */
export type ModoDeVozArmazenado = ModoDeVoz | null;

export function ehModoDeVoz(v: string): v is ModoDeVoz {
  return (MODOS_DE_VOZ as readonly string[]).includes(v);
}

/**
 * Por que a decisão foi a que foi. Vocabulário FECHADO e curto: entra no trace
 * do turno e no log, e é o que permite responder "por que este turno saiu sem
 * voz" sem adivinhar. Nada aqui carrega o corpo (sem PII).
 */
export type MotivoDaVoz =
  // o estado "como antes": o modelo manda, sem lint
  | "modo_padrao"
  // decisão do MODO
  | "modo_nunca"
  | "modo_sempre"
  | "cliente_mandou_audio"
  | "cliente_pediu_voz"
  | "modo_exige_audio_do_cliente"
  | "sem_sinal_de_voz"
  | "modelo_pediu_voz"
  // o que a VOZ estragaria (rebaixa para texto)
  | "texto_tem_link"
  | "texto_tem_email"
  | "texto_tem_codigo"
  | "texto_longo"
  | "texto_em_lista"
  | "texto_vazio"
  // a voz é DESNECESSÁRIA (não é o que ela estraga — ver `FALA_CURTA_MAX_CHARS`)
  | "texto_curto";

export interface DecisaoDeVoz {
  falar: boolean;
  motivo: MotivoDaVoz;
}

export interface EntradaDaVoz {
  modo: ModoDeVozArmazenado;
  /** O `enviar_como_audio` da ferramenta: um PEDIDO do modelo, não uma ordem. */
  pedidoDoModelo: boolean;
  /** O que disparou o turno foi uma nota de voz do cliente? */
  clienteMandouAudio: boolean;
  /** O texto cru do cliente neste turno (o que ele escreveu, se escreveu). */
  textoDoCliente: string | null;
  /** O corpo que sairia, já final. */
  corpo: string;
}

/**
 * Sinais EXPLÍCITOS de que o cliente quer ouvir em vez de ler — curado, não uma
 * gramática. A doutrina é a do opt-out (`lib/opt-out/deteccao.ts`): casar pouco e
 * certo é melhor que casar muito e errado, porque um falso positivo aqui gasta
 * crédito e manda áudio a quem não pediu.
 *
 * Cobre português e espanhol. `dirigindo`/`dirigir` entram porque é o pedido
 * real medido no canal: quem está ao volante pede áudio justamente para não ler.
 *
 * ⚠️ Os padrões estão SEM ACENTO e o texto é normalizado antes de casar, pelo
 * motivo medido em `before-send.ts` (`semAcento`): o `\b` do JS é ASCII-only, e
 * `\b(áudio)` NUNCA casa " áudio" — o `á` não é "word char" pra ele, então não há
 * fronteira entre o espaço e ele. Padrão acentuado aqui reprovaria o próprio caso
 * que este módulo existe para pegar.
 */
const SINAIS_DE_PEDIDO_DE_VOZ = [
  // pedido direto de áudio
  /\bmanda(r|me|me lo|melo)?\b[^.!?\n]{0,20}\b(audio)\b/,
  /\baudio\b[^.!?\n]{0,15}\b(por favor|pfv|pf|please)\b/,
  /\b(prefiro|quero|pode ser|melhor)\b[^.!?\n]{0,20}\b(audio|ouvir|escuchar|oir)\b/,
  /\b(manda|envia|envie|mande)\b[^.!?\n]{0,20}\b(escuchar|escute|oir)\b/,
  // dificuldade de ler
  /\bnao (consigo|posso|da)\b[^.!?\n]{0,15}\b(ler|lendo|leer)\b/,
  /\b(estou|to)\b[^.!?\n]{0,10}\bdirigindo\b/,
  /\b(estoy|ando)\b[^.!?\n]{0,10}\b(manejando|conduciendo)\b/,
];

/** O cliente PEDIU voz em texto? Conservador de propósito — ver a lista acima. */
export function clientePedeVoz(texto: string | null): boolean {
  if (texto === null) return false;
  const t = semAcento(texto.trim());
  if (t === "") return false;
  return SINAIS_DE_PEDIDO_DE_VOZ.some((re) => re.test(t));
}

/**
 * Tira acento para o `\b` do JS voltar a funcionar (ver a nota na lista acima).
 * Mesmo utilitário de `before-send.ts`, e pela mesma razão.
 */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * A VOZ DO ÁUDIO — o corpo TTS-ready: sem emoji, sem risada escrita.
 *
 * ⚠️ O problema NÃO é estético, e é por isso que isto mora no código e não no
 * prompt. O modelo escreve como no WhatsApp — "😁", "🙏", "combinado kkkk" — e o
 * corpo ia CRU para a síntese. A Fish lê o emoji: o cliente OUVE a risada numa
 * parte séria do funil ("essa doença vai rapidamente para o grau 3, depois vira
 * cirrose 😅" sai com risada no meio). Medido: 1 em cada 4 áudios do funil tinha
 * emoji, em 140 áudios em dois dias. Pedir no prompt não resolve: é a mesma
 * classe de defeito do marcador `[ÁUDIO]` no corpo — o modelo lembra às vezes.
 *
 * Tira o emoji e o riso escrito, e normaliza a pontuação que sobra. O TEXTO que
 * o CRM registra NÃO muda: o que o cliente lê no histórico continua igual ao que
 * sempre foi. Isto é só o que a voz fala.
 *
 * A lista por casamento de FAIXA Unicode (não um catálogo de emojis): cobrir
 * cada emoji à mão garante que o próximo lançado passe batido, e a faixa pega o
 * próximo junto. As exclusões são os dois sinais que CARREGAM sentido falado —
 * o cifrão (preço) e o R (marca) —, os únicos emoji-like cujo texto importa.
 */
export function corpoParaVoz(corpo: string): string {
  let t = corpo;
  // Emoji e pictogramas, menos `$` e `®` (que têm valor falado).
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, (m) =>
    m === "₹" || m === "💲" || m === "®" ? m : "",
  );
  // Riso escrito: vira SILÊNCIO, não vira palavra. "kkkk" falado sai como uma
  // gargalhada sintetizada — pior que o silêncio, porque a voz é da marca.
  t = t.replace(/\b(k{3,}|(?:ha){3,}|(?:rs){2,}|(?:he){3,})\b/gi, "");
  // A pontuação que sobra de um emoji removido ("dúvida? 😊" -> "dúvida?  ")
  t = t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?;:])/g, "$1").replace(/\s+$/gm, "");
  return t.trim();
}

/**
 * A FRONTEIRA ENTRE ESCREVER E FALAR — abaixo disto a pergunta sai em TEXTO.
 *
 * Medido no ROTEIRO do funil (o Dr. Carlos, 21 falas marcadas): as falas de
 * TEXTO têm 37 a 97 caracteres — "Entendi, qual é o seu peso e sua altura?",
 * "Você faz o uso de bebidas alcoólicas?", "Há quanto tempo você vem sentindo
 * esses sintomas?" — e as de ÁUDIO começam em 149 e vão a 1.237. Há um vão
 * limpo entre 97 e 149: nada do roteiro cai no meio.
 *
 * ⚠️ A régua é o TAMANHO da fala, não o rótulo `[TEXTO]`/`[ÁUDIO]` do prompt.
 * Rotular exigiria o modelo lembrar de propagar a marca até a ferramenta, e o
 * defeito que este módulo conserta tem exatamente essa forma — capacidade que
 * depende de o modelo lembrar não existe metade das vezes. O tamanho está no
 * corpo que vai sair, sempre, sem o modelo pedir nada.
 *
 * O limiar fica em 120: acima do maior `[TEXTO]` medido (97) e abaixo do menor
 * `[ÁUDIO]` medido (149) — com margem para os dois lados, porque uma fala real
 * cresce ou encolhe alguns caracteres em relação ao roteiro.
 *
 * ⚠️ Vale só onde o MODO ligou a voz. Pedido EXPLÍCITO — o cliente dizendo que
 * não consegue ler, ou o modelo pedindo voz — vence esta régua: quem pediu,
 * pediu. Sem essa ressalva, `decidir` + cliente pedindo áudio devolveria texto.
 */
export const FALA_CURTA_MAX_CHARS = 120;

/**
 * O que a voz ESTRAGA. Devolve o motivo do rebaixamento, ou `null` quando o
 * texto vai bem em áudio. Pura, e é o que segura o modo `sempre`.
 *
 * Casar por FORMA (link, e-mail, código, tamanho), nunca por conteúdo: um "não"
 * ou um "R$ 1.500,00" continuam indo bem em voz — o que não vai é o que existe
 * para ser COPIADO ou TOCADO.
 */
export function corpoVaiBemEmVoz(corpo: string): MotivoDaVoz | null {
  const texto = corpo.trim();
  if (texto === "") return "texto_vazio";
  if (texto.length > 2_500) return "texto_longo";
  const t = semAcento(texto);
  // Link e e-mail se COPIAM; ninguém copia o que ouve.
  if (/https?:\/\/\S+/.test(t) || /\bwww\.\S+/.test(t)) return "texto_tem_link";
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(t)) return "texto_tem_email";
  // Código: CPF/CNPJ/pedido/PIX/telefone — 8+ dígitos seguidos (com separadores
  // contados entre eles). Preço NÃO cai aqui: "R$ 1.500,00" tem 6.
  if (/\d[\d.\-/()\s]{6,}\d/.test(texto)) {
    const digitos = texto.replace(/[^0-9]/g, "");
    if (digitos.length >= 8) return "texto_tem_codigo";
  }
  // Três linhas ou mais é lista/roteiro — áudio lê tudo numa tacada e some. Duas
  // quebras (três linhas) já bastam: bolha de conversa é uma ou duas linhas, e
  // rebaixar para texto é a direção SEGURA (texto sempre funciona; voz errada não).
  //
  // ⚠️ A LINHA EM BRANCO NÃO CONTA. Quem separa assim é o PRÓPRIO motor: o
  // `instrucaoDeBolhas` (split-message.ts) manda o modelo escrever cada ideia em
  // seu parágrafo, com uma linha em branco entre eles, porque é assim que o
  // `sendInBubbles` corta as bolhas. Contar essa quebra como "lista" rebaixava
  // para TEXTO exatamente as falas de etapa do funil — as que mais precisam de
  // voz — e o sintoma no atendimento era "o modelo pediu voz e não saiu áudio".
  // Lista de verdade (endereço/CNPJ, um item por linha SIMPLES) continua
  // rebaixando, porque essas quebras sobrevivem ao colapso dos parágrafos.
  const semParagrafos = texto.replace(/\n[ \t]*\n+/g, " ");
  const quebras = (semParagrafos.match(/\n/g) ?? []).length;
  if (quebras >= 2) return "texto_em_lista";
  // Por último, e só por último: fala curta já passou por TODOS os vetos acima,
  // então isto nunca esconde um link ou um CNPJ — só evita gastar crédito de voz
  // numa pergunta que se lê num relance.
  if (texto.length < FALA_CURTA_MAX_CHARS) return "texto_curto";
  return null;
}

/**
 * A decisão do turno. Pura: nenhuma rede, nenhum banco, nenhum relógio.
 *
 * A ordem importa e é o desenho:
 *
 *  1. **`nunca` manda sozinho** — recusa inclusive o pedido do modelo. É a
 *     autoridade da tela, e é o que faz "esta conta não manda áudio" ser verdade
 *     mesmo quando o prompt insiste.
 *  2. **O MODO decide o querer**: `sempre` quer; `quando_cliente_fala` quer só
 *     quando o cliente mandou áudio; `decidir` quer com QUALQUER sinal (áudio do
 *     cliente, pedido em texto, ou o pedido do modelo).
 *  3. **O LINT por último** — o que a voz estragaria rebaixa para texto mesmo
 *     no `sempre`. Ligar voz nunca é desculpa para mandar um link falado. A
 *     régua de TAMANHO (`texto_curto`) é a única que um pedido explícito vence;
 *     link, código e lista vencem qualquer pedido, porque não há o que ouvir.
 */
export function decidirModalidadeDeVoz(entrada: EntradaDaVoz): DecisaoDeVoz {
  const { modo, pedidoDoModelo, clienteMandouAudio, textoDoCliente, corpo } = entrada;

  // O estado "como antes": o modelo manda, e SEM lint — preserva a saída exata
  // de quem já publicou com voz. Ver o cabeçalho de `ModoDeVozArmazenado`.
  if (modo === null) {
    return pedidoDoModelo ? { falar: true, motivo: "modo_padrao" } : { falar: false, motivo: "modo_padrao" };
  }

  if (modo === "nunca") return { falar: false, motivo: "modo_nunca" };

  let quer: boolean;
  let motivo: MotivoDaVoz;

  if (modo === "sempre") {
    quer = true;
    motivo = "modo_sempre";
  } else if (modo === "quando_cliente_fala") {
    // Simetria de canal: responde no mesmo meio que o cliente usou. O pedido do
    // modelo NÃO abre exceção aqui — quem não mandou áudio não recebe áudio.
    quer = clienteMandouAudio;
    motivo = clienteMandouAudio ? "cliente_mandou_audio" : "modo_exige_audio_do_cliente";
  } else {
    // `decidir` — o modo recomendado: qualquer sinal liga.
    if (clienteMandouAudio) {
      quer = true;
      motivo = "cliente_mandou_audio";
    } else if (clientePedeVoz(textoDoCliente)) {
      quer = true;
      motivo = "cliente_pediu_voz";
    } else if (pedidoDoModelo) {
      quer = true;
      motivo = "modelo_pediu_voz";
    } else {
      quer = false;
      motivo = "sem_sinal_de_voz";
    }
  }

  if (!quer) return { falar: false, motivo };

  // ⚠️ `pedidoExplicito` — o cliente dizendo que não consegue ler, ou o modelo
  // pedindo voz. Quem PEDIU, pediu: a régua de fala curta abaixo não derruba um
  // pedido, senão `decidir` + "me manda áudio" devolveria texto — e o gatilho
  // que mais existe no canal é justamente o cliente que não pode ler.
  const pedidoExplicito =
    modo === "sempre" ? pedidoDoModelo : clienteMandouAudio || clientePedeVoz(textoDoCliente) || pedidoDoModelo;

  const rebaixa = corpoVaiBemEmVoz(corpo);
  // O rebaixamento de TAMANHO é do MODO, não do pedido: o modo `sempre` fala o
  // que é longo e escreve o que é curto; mas quem pediu voz tem direito à voz.
  if (rebaixa === "texto_curto" && pedidoExplicito) {
    return { falar: true, motivo };
  }
  if (rebaixa !== null) return { falar: false, motivo: rebaixa };

  return { falar: true, motivo };
}