# Motor 1 — WhatsApp Gateway (Liz AI)

Serviço (Fastify + TypeScript) que recebe webhooks da WhatsApp Cloud API, valida assinatura do Meta, persiste inbound/outbound/statuses no Postgres (Supabase), enfileira processamento (BullMQ + Redis) e roda um worker separado para responder (stub MVP).

## Rotas

- `GET /wa/webhook`: challenge do webhook (Meta)
- `POST /wa/webhook`: eventos (mensagens + statuses). **Rápido**: valida, salva, enfileira, responde 200.
- `POST /wa/send`: endpoint interno (autenticado por `X-Internal-Key`) para enviar via Graph API
- `GET /`: healthcheck

## Requisitos / Variáveis de ambiente

Crie um `.env` local (não commitar) com:

```
PORT=8080

# Meta Webhook
WA_VERIFY_TOKEN=uma_string_aleatoria_bem_grande
META_APP_SECRET=SEU_APP_SECRET

# Postgres (Supabase)
DATABASE_URL=postgresql://...

# Redis (Upstash)
REDIS_URL=rediss://...

# Envio (Graph API)
WA_ACCESS_TOKEN=EAAG...
WA_GRAPH_API_VERSION=v20.0

# API interna
INTERNAL_API_KEY=uma_chave_interna_bem_grande

# Worker
WA_WORKER_CONCURRENCY=5
```

## Banco (Supabase) — migrations/seed

Arquivos:
- `supabase/migrations/0001_motor1.sql`
- `supabase/seed.sql`

Aplicar (exemplo via Supabase CLI):

```bash
supabase db push
supabase db seed
```

Depois, crie 1 `wa_account` apontando para o `phone_number_id` do seu número (vem no webhook em `value.metadata.phone_number_id`):

```sql
insert into public.wa_accounts (workspace_id, phone_number_id, display_phone_number, waba_id)
select id, 'SEU_PHONE_NUMBER_ID', 'SEU_DISPLAY_PHONE', 'SEU_WABA_ID'
from public.workspaces
where slug = 'default'
on conflict (phone_number_id) do nothing;
```

## Rodar local

Instalar:

```bash
npm install
```

Terminal 1 (API):

```bash
npm run dev
```

Terminal 2 (Worker):

```bash
npm run dev:worker
```

## Testes rápidos (smoke)

### 1) Challenge do webhook

```bash
curl "http://localhost:8080/wa/webhook?hub.mode=subscribe&hub.verify_token=uma_string_aleatoria_bem_grande&hub.challenge=123"
```

Deve retornar `123`.

### 2) Envio interno (/wa/send)

```bash
curl -X POST "http://localhost:8080/wa/send" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  -d '{"phoneNumberId":"SEU_PHONE_NUMBER_ID","to":"55XXXXXXXXXXX","type":"text","text":"ping"}'
```

## Deploy no Fly.io (API + Worker)

O `fly.toml` está configurado com process groups:
- `api`: `node dist/index.js`
- `worker`: `node dist/worker.js`

### Secrets (não colar aqui)

```bash
fly secrets set \
  WA_VERIFY_TOKEN="..." \
  META_APP_SECRET="..." \
  DATABASE_URL="..." \
  REDIS_URL="..." \
  WA_ACCESS_TOKEN="..." \
  INTERNAL_API_KEY="..."
```

### Deploy

```bash
fly deploy
```

### Garantir 1 API + 1 Worker

```bash
fly scale count api=1 worker=1
```

### Logs

```bash
fly logs
```

### URL pública

`https://SEUAPP.fly.dev/wa/webhook`

Testar challenge:

```bash
curl "https://SEUAPP.fly.dev/wa/webhook?hub.mode=subscribe&hub.verify_token=SUA_STRING&hub.challenge=123"
```

## Checklist de validação end-to-end (MVP)

1. Challenge `GET /wa/webhook` responde corretamente.
2. Mandar uma mensagem do celular → webhook responde `200` rápido.
3. `wa_messages` recebe `direction='in'` com `payload` e resumo (`message_type`, `text_body`/`media_id`).
4. Job aparece na fila `wa_inbound` e o worker consome.
5. O WhatsApp recebe a resposta “Recebi sua mensagem ✅”.
6. Status `delivered/read/failed` chega no webhook e é salvo em `wa_status`.

