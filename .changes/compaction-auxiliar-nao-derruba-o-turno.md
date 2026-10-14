---
impacto: nada_mudou
secao: corrigido
titulo: Conversa longa não deixa mais o cliente sem resposta
---

Quando a conversa com um cliente já era longa, o sistema usava um modelo
auxiliar para resumir o histórico antes de o agente responder. Se esse resumo
viesse malformado — o que o provedor faz devolvendo "tudo certo" com o corpo
errado —, a conversa inteira era descartada e o cliente não recebia resposta
nenhuma, mesmo com o agente funcionando. O mesmo valia quando o provedor estava
fora do ar naquele momento. O cliente ficava esperando por uma resposta que
nunca chegava.

Agora essa etapa é o que sempre deveria ter sido: acessória. Se ela falhar, o
agente responde normalmente com o histórico sem resumir, e o problema fica
registrado no log. Se a organização tiver estourado o orçamento de IA, a
conversa continua sendo passada para uma pessoa — isso não mudou.

Nada muda no que o agente fala nem na tela.
