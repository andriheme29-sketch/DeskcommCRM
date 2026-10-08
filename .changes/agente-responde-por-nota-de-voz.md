---
impacto: capacidade_nova
secao: adicionado
titulo: O agente passa a poder responder por nota de voz — com a chave na tela, a voz escolhida dentro do agente, e um modo que decide quando falar
---

Até agora o agente só tinha um jeito de falar: texto. `send_message` ganhou o
argumento `enviar_como_audio`, e com ele a resposta sai como **nota de voz** —
áudio de verdade no aparelho do cliente, precedido do "gravando áudio..." e com a
espera do tamanho do arquivo, em vez do tempo que se levaria para digitar.

**A chave da voz se cadastra na tela.** Em **IA › Credenciais** aparece o serviço
**Voz**, com dois provedores: **ElevenLabs** (a chave da sua conta; o endereço é
opcional, para quem fala por um proxy) e o provedor **Voz por endpoint próprio** — qualquer gateway que fale o `/audio/speech` da OpenAI, seja 9Router, LiteLLM ou um proxy corporativo. Você informa endereço, chave e voz, e a chave fica guardada cifrada como as outras. Alternativa: `ELEVENLABS_API_KEY` no `.env` da instalação, que continua valendo como o degrau final.

**A voz é escolhida dentro do agente.** Na tela do agente você diz qual provedor
de voz, qual chave, qual voz e qual modelo aquele agente usa — e um **modo**:

- **Como antes (o prompt decide)** — o padrão; é o que quem já usava mantém.
- **Nunca mandar áudio** — texto sempre, mesmo se o prompt pedir voz.
- **Só quando o cliente mandar áudio** — responde em voz a quem falou em voz.
- **Sempre responder em voz** — com uma trava: link, e-mail, código de pedido
  (CPF, PIX, boleto) e listas continuam saindo em **texto**, porque essas coisas
  se copiam e se tocam, não se ouvem.
- **Decidir sozinho (recomendado)** — manda voz quando o cliente mandou áudio,
  pediu voz, ou o prompt pedir; texto no resto.

O modo é quem decide, de forma determinística — não depende de o modelo lembrar.
O que o prompt pedir continua valendo, mas dentro do que o modo permite.

Áudio e foto do produto não vão na mesma mensagem: uma nota de voz não carrega
álbum. **Sem chave de voz nada muda**: a mensagem sai em texto — nenhuma
instalação é obrigada a contratar TTS, e o CRM nunca deixa de responder por causa
da voz. Se a síntese falhar no meio de um atendimento, o mesmo acontece: sai
texto, e o motivo fica no log do turno.