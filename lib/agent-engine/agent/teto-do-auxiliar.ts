/**
 * O TETO DE RELÓGIO das chamadas auxiliares do turno (classificadores).
 *
 * ## O defeito que fez este módulo existir (medido em produção)
 *
 * O turno roda `stage_classifier`, `jailbreak_detect` e o Jev dentro de um
 * `Promise.all`, ao lado da resposta (`inbound-turn.ts`). O `Promise.all` espera
 * o MAIS LENTO — então um classificador travado não atrasa só a si mesmo: ele
 * segura a resposta do cliente.
 *
 * `runModelCall` **não tinha teto de relógio**: só o `count-tokens` usa
 * `AbortSignal.timeout`. Medido em 48h nesta instalação, na tabela `llm_calls`:
 *
 *   - `jailbreak_detect`: p50 2s, **máximo 908s**
 *   - `stage_classifier`: p50 5s, **máximo 908s**
 *   - `checkpoint`: p50 8s, máximo 207s
 *
 * Com o cliente esperando, o pior caso de 15 minutos é a resposta que nunca chega
 * — e o lead desiste. Os dois classificadores SÃO advisórios por construção
 * (ambos degradam para "sem sinal" no `catch`), então um teto não muda a decisão
 * do turno: ele só impede que a dica opcional vire o gargalo do atendimento.
 *
 * ## Por que o teto mora AQUI e não no call site
 *
 * Mesmo motivo de `aux-model-args.ts`: a constante é a parte que erra, e dentro
 * de `executarTurnoDoAgente` (não exportada) ela ficaria sem como ser exercitada
 * por unit. Aqui é um número, testável, num lugar só.
 *
 * ## Como o teto se comporta
 *
 * O `runModelCall` já respeita `abortSignal` (o mesmo caminho do `count-tokens`).
 * Abortar faz o `fetch` rejeitar, o `catch` do classificador registrar o `warn`
 * e o turno **seguir sem o sinal** — exatamente o que já acontece quando o
 * provedor falha. Nada de novo é introduzido no fluxo de decisão; o que muda é
 * que "sem sinal" deixa de poder custar 15 minutos.
 *
 * 8s é folgado para um classificador de mensagem curta com modelo barato (o p50
 * medido é 2–5s) e continua muito abaixo do que o cliente tolera esperando.
 */
export const TETO_AUXILIAR_MS = 8_000;

/**
 * Devolve um `AbortSignal` que aborta o auxiliar depois de `tetoMs`.
 *
 * Vive fora do turno pelo mesmo motivo do resto: testável sem banco, sem job e
 * sem registry. `tetoMs` é parâmetro para o teste conseguir exercitar o aborto
 * sem esperar 8 segundos.
 */
export function sinalDoAuxiliar(tetoMs: number = TETO_AUXILIAR_MS): AbortSignal {
  return AbortSignal.timeout(tetoMs);
}
