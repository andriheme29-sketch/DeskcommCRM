/**
 * ENTREGA PROMETIDA — o detector do `midiaPrometidaGate`.
 *
 * ═══ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ════════════════════════
 *
 * Medido em produção (13/10, cliente Wellington `+55279991...0526`): às 17:43:04 o
 * agente enviou uma NOTA DE VOZ dizendo
 *
 *     "Inclusive vou te mandar abaixo os últimos depoimentos dos nossos pacientes
 *      que iniciaram o tratamento nos últimos 30 dias [...] Veja os resultados com
 *      bastante atenção."
 *
 * E não mandou vídeo nenhum. A mesma coisa aconteceu com o GUIA ALIMENTAR antes de
 * ele ser ligado: a promessa saía, o anexo não. Medido nos últimos 4 dias: **13
 * promessas de mídia, 6 sem entrega**.
 *
 * ─── Por que acontece ──────────────────────────────────────────────────────
 *
 * O modelo anuncia a mídia na fala e não faz a segunda chamada. Ele não pode fazer
 * as duas na MESMA chamada: a cadeia recusa ("áudio e mídia não vão juntos — uma nota
 * de voz não carrega álbum"), e com razão. A promessa sai em áudio, e o vídeo exigiria
 * um segundo `send_message` com `video_codigo` — que ele simplesmente não faz.
 *
 * O dano é o pior tipo: prova social prometida e não entregue. O cliente é avisado
 * de que vai ver depoimentos de quem já tratou e fica sem nada — a credibilidade cai
 * justamente no ponto em que a venda se decide.
 *
 * ─── Por que é código e não instrução ──────────────────────────────────────
 *
 * É o mesmo formato do `agenda_stall`: uma promessa de AÇÃO PRÓPRIA que depende de
 * uma ferramenta não ter sido executada neste turno. Prompt não segura isso (o modelo
 * "acha" que vai mandar depois). A régua é determinística e o veto volta ao laço como
 * erro instrutivo, nomeando a ferramenta e o código certo.
 *
 * ─── O que ele NÃO pega, de propósito ─────────────────────────────────────
 *
 * - Prometer o que NÃO depende de ferramenta ("vou te explicar", "vou te acompanhar",
 *   "vou verificar com a equipe") — não é mídia.
 * - Mencionar que a pessoa VAI VER algo depois da compra ("você vai receber o guia
 *   junto do produto") — não é promessa de envio agora.
 * - Falar de mídia que já foi enviada ("como te mandei no vídeo acima").
 */

/** O que foi prometido. Categorias são rótulos NOSSOS e fechados: vão ao trace. */
export type CategoriaDeMidia = 'video' | 'documento' | 'foto';

export interface AchadoDeMidiaPrometida {
  achou: boolean;
  categorias: CategoriaDeMidia[];
}

/**
 * O verbo de promessa de envio — "vou te mandar", "te mando", "segue abaixo".
 *
 * ⚠️ Exige o VERBO DE ENVIO (mandar, enviar, mostrar) e não só o futuro: "vou te
 * explicar os depoimentos" não promete anexo.
 */
const PROMESSA =
  /(?:\b(?:vou|vamos|irei|iremos)\b[^.!?\n]{0,30}\b(?:mandar|mandando|enviar|enviando|mostrar|mostrando|passar|passando)\b|\b(?:te|j[aá])\s+mando\b|\bsegue\s+(?:abaixo|aqui|o|a|os|as)\b|\b(?:olha|veja|assiste|confira)\b[^.!?\n]{0,20}\b(?:abaixo|aqui)\b|\b(?:t[aá]|est[aá])\s+(?:abaixo|aqui)\b)/i;

/** A mídia que depende de ferramenta para sair. */
const MIDIA: ReadonlyArray<{ re: RegExp; categoria: CategoriaDeMidia }> = [
  {
    re: /\b(?:v[ií]deo|depoimento|depoimentos|prova\s+social|resultados?\s+dos?\s+(?:nossos\s+)?(?:pacientes|clientes))\b/i,
    categoria: 'video',
  },
  {
    re: /\b(?:guia|plano\s+alimentar|pdf|documento|apostila|material\s+(?:escrito|completo))\b/i,
    categoria: 'documento',
  },
  {
    re: /\b(?:foto|fotos|imagem|imagens|fotos?\s+do\s+(?:produto|tratamento)|antes\s+e\s+depois)\b/i,
    categoria: 'foto',
  },
];

function normaliza(body: string): string {
  return body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Detecta a promessa de mídia. Determinístico e conservador, como os irmãos:
 * vazio/whitespace = nada encontrado.
 *
 * A promessa e a mídia precisam estar na MESMA frase (sem cruzar `.`, `!`, `?` ou
 * `\n`): "vou te mandar o vídeo" casa; "vou pensar na sua proposta. O vídeo é bom"
 * não casa.
 */
export function detectarMidiaPrometida(body: string): AchadoDeMidiaPrometida {
  if (body.trim() === "") return { achou: false, categorias: [] };
  const texto = normaliza(body);
  const frases = texto.split(/[.!?\n]+/);
  const categorias = new Set<CategoriaDeMidia>();
  for (const frase of frases) {
    if (!PROMESSA.test(frase)) continue;
    for (const { re, categoria } of MIDIA) {
      if (re.test(frase)) categorias.add(categoria);
    }
  }
  return { achou: categorias.size > 0, categorias: [...categorias] };
}

/**
 * O texto que volta ao modelo — o ENSINO, com o CÓDIGO certo de cada mídia.
 *
 * ⚠️ Nomeia o código porque é isso que o modelo precisa para a segunda chamada.
 * Um veto que só diz "não prometa" o deixa sem o caminho de cumprir a promessa.
 */
export function renderVetoDeMidiaPrometida(categorias: readonly CategoriaDeMidia[]): string {
  const instrucoes: string[] = [];
  if (categorias.includes("video")) {
    instrucoes.push(
      "para os depoimentos, chame `send_message` com `video_codigo: \"depoimento\"` (a legenda do vídeo vai no corpo) — e o vídeo de logística é `video_codigo: \"logistica\"`",
    );
  }
  if (categorias.includes("documento")) {
    instrucoes.push(
      "para o guia alimentar, chame `send_message` com `documento_codigo: \"plano-alimentar\"`",
    );
  }
  if (categorias.includes("foto")) {
    instrucoes.push(
      "para as fotos do produto, chame `send_message` com `produto_codigo` (ex.: \"fignar-5\" para a principal)",
    );
  }
  return (
    "Mensagem BARRADA antes do envio. Você PROMETEU mandar mídia nesta mensagem e não " +
    "chamou a ferramenta que a envia NESTE turno. O cliente receberia o anúncio e ficaria " +
    "sem o material — isso queima a venda. Duas saídas, escolha UMA: " +
    "(a) mande a mídia agora — " +
    instrucoes.join("; ") +
    " — e a legenda pode ser esta mesma mensagem; ou (b) reescreva a mensagem SEM prometer " +
    "nada: fale do que você tem para dizer e siga o funil, sem citar depoimento, vídeo, " +
    "guia ou foto. Detalhe importante: áudio e mídia NÃO vão na mesma chamada — se a " +
    "mensagem for nota de voz, o anexo precisa de uma segunda chamada só com o código."
  );
}