---
impacto: nada_mudou
secao: corrigido
titulo: O turno que demora não é mais descartado e refeito no meio
---

Quando o agente levava mais tempo para responder — conversa longa, áudio, foto —
o sistema podia considerar o trabalho perdido antes de ele terminar, e o
atendimento recomeçava do zero: a resposta era gerada de novo e o cliente podia
receber duas vezes, ou não receber nada se o job morresse no caminho.

O tempo que o sistema esperava por um turno em andamento estava a poucos
segundos do turno mais lento já medido nesta operação. Agora o trabalho em
andamento avisa que continua vivo enquanto roda, e o limite passou a ser apenas
a rede de segurança para o caso em que o próprio aviso não consegue sair.
Nada muda no que o agente fala nem na tela.
