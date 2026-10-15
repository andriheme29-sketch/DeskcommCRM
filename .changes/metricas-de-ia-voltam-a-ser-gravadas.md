---
impacto: nada_mudou
secao: corrigido
titulo: As métricas de IA voltam a ser gravadas (estavam paradas desde 08/10)
---

O worker gravava as métricas de cada turno de IA (`run_llm_calls`, tokens, custo, latência,
tempo de fila) com o `organization_id` chegando ao banco como texto, numa coluna que é `uuid`.
O Postgres recusava o insert inteiro com `expression is of type text` e o erro era apenas
registrado no log do worker — o turno continuava normalmente, então o defeito não tinha sintoma
visível: as métricas simplesmente deixaram de existir em 2026-10-08 e Uso de IA, custo e alerta
de cache passaram a mostrar dados congelados. Agora o insert tipa o valor como `uuid` e cada
turno volta a gravar. As métricas do período em que esteve quebrado não são recuperadas.
Nada precisa ser feito ao atualizar.
