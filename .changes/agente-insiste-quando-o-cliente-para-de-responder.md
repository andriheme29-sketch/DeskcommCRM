---
impacto: capacidade_nova
secao: adicionado
titulo: O agente passa a insistir quando o cliente para de responder — duas tentativas, de 3 em 3 horas, e o negócio vai para reativação se ninguém voltar
---

Até agora, quando o cliente parava de responder no meio da conversa, ninguém
insistia: a conversa esfriava em silêncio, e só um follow-up desenhado à mão
(o construtor de fluxos) retomava o contato. Agora **o próprio agente persiste**,
e isso se liga na tela do agente, sem montar fluxo nenhum.

Na tela do agente, dentro de **Follow-up**, aparece **"Insistir quando o cliente
para de responder"**: você escolhe de quantas em quantas horas (padrão **3**) e
quantas **tentativas** (padrão **2**). Ligado, o comportamento passa a ser:

- o agente responde → o relógio de 3 h começa a contar da mensagem que **ele**
  mandou;
- se o cliente não voltar, o agente manda **uma tentativa** — escrita por ele,
  na voz dele, com o contexto da conversa;
- sem resposta, espera mais 3 h e manda **a segunda tentativa**;
- sem resposta às duas, o negócio entra em **reativação** (a proposta que aparece
  para a equipe decidir, e que vence sozinha se ninguém agir).

Quem zera o relógio é **só o cliente**: qualquer resposta dele cancela o ciclo —
o agente não fica insistindo com quem já voltou a falar. E a retentativa **não
insiste em quem já saiu do funil**: negócio ganho ou perdido (etapa marcada como
ganho/perdido) fica de fora.

A espera respeita a **janela de envio**: se o relógio vencer de madrugada, a
tentativa sai na abertura seguinte (a partir das 7 h), nunca no meio da noite.
Valem as mesmas proteções de todo envio automático — limite diário, aquecimento
do número, ritmo entre mensagens e a regra de **uma retomada por conversa**, para
o mesmo cliente não receber duas sequências paralelas.

Desligado, nada muda: é o comportamento de sempre, e nenhuma instalação é
obrigada a usar.