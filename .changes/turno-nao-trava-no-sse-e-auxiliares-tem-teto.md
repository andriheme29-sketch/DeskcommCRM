---
impacto: nada_mudou
secao: corrigido
titulo: O atendimento automático volta a responder rápido e para de re-tentar o turno
---

O turno do agente estava ficando lento e, em alguns casos, sendo re-tentado do
começo. Duas causas, as duas medidas nesta operação:

1. O gateway de IA devolve o JSON com um terminador de streaming colado no fim, e
   o sistema cortava no primeiro "data:" que encontrava. Como o modelo escreve
   "dados do cliente" e "personal data" dentro do próprio JSON, o corte caía no
   meio e o turno morria. Acontecia em 84% das chamadas de compactação — e cada
   falha custava uma re-tentativa inteira, com o cliente esperando.

2. As verificações que rodam junto do turno (classificação de estágio, detecção
   de manipulação e o fechamento do turno) não tinham limite de tempo. Uma delas
   presa segurava a resposta do cliente: medido até 2min44 no fechamento e 15min
   numa das verificações. Agora todas têm teto de 8 segundos e o atendimento
   segue sem elas, como já acontecia quando o provedor falhava.

Também voltam a ser gravadas as métricas de uso da IA, que estavam congeladas
desde 08/10 por um erro de tipo na gravação (o turno continuava normalmente, e o
erro só aparecia no log — por isso ninguém percebeu).

Medido depois da correção: fechamento do turno p50 de 13,5s para 3,1s e máximo
de 2min44 para 7,5s; nenhuma falha de JSON nos turnos novos. Nada precisa ser
feito ao atualizar.
