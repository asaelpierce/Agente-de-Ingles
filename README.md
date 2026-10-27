# Tech English Coach (voz + texto)

App de conversação em inglês para TI: chamada de voz em tempo real (OpenAI Realtime via WebRTC, com modo clássico de reserva), voz natural do coach (OpenAI TTS), correções em português, simulações, vocabulário e gramática. Modos: conversa, simulação, vocabulário, gramática e atividades (exercícios gerados na hora com XP e sequência de dias). O GPT responde por trás via `api/chat.js` (função serverless da Vercel), então a chave nunca vai para o navegador.

## Publicar na Vercel (uma vez)

1. Instale o Node.js (https://nodejs.org) se ainda não tiver.
2. Descompacte esta pasta e, dentro dela, no terminal:

```
npx vercel login
npx vercel --prod
```

   Aceite os padrões (projeto novo, nome `tech-english-coach`, sem framework).

3. Em https://vercel.com → projeto → Settings → Environment Variables, crie:

   | Nome               | Valor                                        |
   |--------------------|----------------------------------------------|
   | `OPENAI_API_KEY`   | sua chave `sk-...` da OpenAI                 |
   | `APP_PASSWORD`     | um código de acesso (ex.: `kb-8c4b5597`)     |
   | `OPENAI_MODEL`     | opcional, padrão `gpt-6-astra` (mais barato: `gpt-6-luna`) |
   | `OPENAI_REASONING` | opcional, padrão `low` (none, low, medium, high) |
   | `OPENAI_FAST_MODEL` | opcional, padrão `gpt-6-luna` (respostas de texto, correções, traduções) |
   | `OPENAI_REALTIME_MODEL` | opcional, padrão `gpt-realtime-2.1` (chamada de voz em tempo real) |
   | `OPENAI_REALTIME_VOICE` | opcional, padrão `marin` |
   | `OPENAI_TRANSCRIBE_MODEL` | opcional, padrão `gpt-transcribe` (exercício Repetir e chamada clássica) |
   | `OPENAI_TTS_VOICE` | opcional, padrão `nova` (ou alloy, echo, shimmer, onyx, fable) |

4. Rode `npx vercel --prod` de novo para as funções lerem as variáveis.
5. Abra a URL do projeto no Chrome ou Edge, digite o código de acesso e clique em **Conversar por voz**.

Se preferir usar o Claude em vez do GPT, configure `ANTHROPIC_API_KEY` em vez de `OPENAI_API_KEY` (a voz natural precisa da chave OpenAI; sem ela o app usa a voz do navegador).

## Testar local

```
npx vercel dev
```

(crie um `.env` com `OPENAI_API_KEY=...` e `APP_PASSWORD=...` antes.)

## Custo

Cada fala gera uma chamada curta ao modelo mais um trecho de áudio; uma sessão de 30 minutos costuma ficar em poucos centavos de dólar. Para gastar menos, mude a voz para "do navegador" no topo da página.
