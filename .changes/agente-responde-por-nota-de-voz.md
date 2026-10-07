---
impacto: capacidade_nova
secao: adicionado
titulo: O agente passa a poder responder por nota de voz, e o cliente vê "gravando áudio…"
---

Até agora o agente só tinha um jeito de falar: texto. `send_message` ganhou o
argumento `enviar_como_audio`, e com ele a resposta sai como **nota de voz** — áudio
de verdade no aparelho do cliente, precedido do "gravando áudio…" e com a espera do
tamanho do arquivo, em vez do tempo que se levaria para digitar.

Quem decide **quando** falar em vez de escrever é o prompt do agente: ele chama
`send_message` com `enviar_como_audio: true` nas etapas em que a operação quer voz
(por exemplo, saudação e quebra de objeção) e segue em texto no resto — inclusive
nas etapas em que a tela manda ter o número do pedido, o link ou o preço por
escrito. Áudio e foto do produto não vão na mesma mensagem: uma nota de voz não
carrega álbum, e pedir os dois volta ao modelo como correção, sem descartar nada
em silêncio.

Para ligar, basta uma chave da ElevenLabs em `ELEVENLABS_API_KEY`. `ELEVENLABS_VOICE_ID`
e `ELEVENLABS_MODEL_ID` são opcionais e trocam a voz e o modelo; vazias, valem os
padrões do produto. **Sem a chave nada muda**: o argumento é simplesmente ignorado e
a mensagem sai em texto — nenhuma instalação é obrigada a contratar TTS, e o CRM
nunca deixa de responder por causa da voz. Se a síntese falhar no meio de um
atendimento (chave revogada, cota estourada, provedor fora do ar), o mesmo acontece:
a mensagem sai em texto e o motivo fica no log do turno.
