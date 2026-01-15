import Fastify from "fastify";
import crypto from "crypto";

import { inboundQueue } from "./queue.js";
import { findWaAccountByPhoneNumberId } from "./repos/waAccounts.js";
import { insertInboundMessage } from "./repos/waMessages.js";
import { insertWaStatus } from "./repos/waStatus.js";
import { extractInboundMessageSummary } from "./wa/extractSummary.js";
import { sendMessage } from "./wa/send.js";

const app = Fastify({ logger: true });

// Parser customizado para JSON que preserva o raw body como string
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

function verifySignature(raw: string, signatureHeader?: string) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;

  if (!signatureHeader?.startsWith("sha256=")) return false;
  const theirHex = signatureHeader.slice("sha256=".length);

  const ourHex = crypto
    .createHmac("sha256", secret)
    .update(raw, "utf8")
    .digest("hex");

  // comparar bytes (não texto)
  let their: Buffer;
  let our: Buffer;
  try {
    their = Buffer.from(theirHex, "hex");
    our = Buffer.from(ourHex, "hex");
  } catch {
    return false;
  }

  if (their.length !== our.length) return false;
  return crypto.timingSafeEqual(their, our);
}

function parseMetaTimestampSeconds(ts: unknown): Date | undefined {
  const s =
    typeof ts === "string" ? ts : typeof ts === "number" ? String(ts) : undefined;
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n * 1000);
}

// healthcheck (opcional)
app.get("/", async () => ({ ok: true }));

// 1) Challenge do webhook
app.get("/wa/webhook", async (req, reply) => {
  const q = req.query as any;
  const mode = q["hub.mode"];
  const token = q["hub.verify_token"];
  const challenge = q["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
    return reply.code(200).send(challenge);
  }
  return reply.code(403).send("Forbidden");
});

// 2) Eventos
app.post("/wa/webhook", async (req, reply) => {
  const raw = req.rawBody ?? "";
  const sig = req.headers["x-hub-signature-256"] as string | undefined;

  if (!verifySignature(raw, sig)) {
    req.log.warn({ sigPresent: !!sig }, "Bad signature");
    return reply.code(403).send("Bad signature");
  }

  const body = req.body as any;

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = value?.metadata?.phone_number_id as string | undefined;

  const messages: any[] = Array.isArray(value?.messages) ? value.messages : [];
  const statuses: any[] = Array.isArray(value?.statuses) ? value.statuses : [];

  if (!phoneNumberId) {
    req.log.warn(
      { messagesCount: messages.length, statusesCount: statuses.length },
      "WA event missing phone_number_id"
    );
    return reply.code(200).send("OK");
  }

  const waAccount = await findWaAccountByPhoneNumberId(phoneNumberId);
  if (!waAccount) {
    // configuração faltando (não vale ficar 500 e forçar retries infinitos)
    req.log.error({ phoneNumberId }, "WA account not found for phone_number_id");
    return reply.code(200).send("OK");
  }

  // 1) Persistir statuses (dedupe via unique constraint)
  await Promise.all(
    statuses.map(async (st) => {
      const waMessageId = typeof st?.id === "string" ? st.id : undefined;
      const status = typeof st?.status === "string" ? st.status : undefined;
      if (!waMessageId || !status) return;

      await insertWaStatus({
        waAccountId: waAccount.id,
        waMessageId,
        recipientId: typeof st?.recipient_id === "string" ? st.recipient_id : undefined,
        status,
        statusTimestamp: parseMetaTimestampSeconds(st?.timestamp),
        payload: st,
      });
    })
  );

  // 2) Persistir inbound e enfileirar (webhook rápido; sem IA aqui)
  await Promise.all(
    messages.map(async (msg) => {
      const summary = extractInboundMessageSummary(msg);
      if (!summary) return;

      await insertInboundMessage({
        waAccountId: waAccount.id,
        waMessageId: summary.waMessageId,
        fromNumber: summary.fromNumber,
        messageType: summary.messageType,
        textBody: summary.textBody,
        mediaId: summary.mediaId,
        messageTimestamp: summary.messageTimestamp,
        payload: msg,
      });

      // Mesmo em caso de dedupe (já existe no DB), tentamos enfileirar com jobId fixo:
      // - Se o job já existe, ignore.
      // - Se um request anterior salvou no DB mas falhou antes de enfileirar, este request recupera.
      const jobId = `${waAccount.id}:${summary.waMessageId}`;
      try {
        await inboundQueue.add(
          "inbound",
          { waAccountId: waAccount.id, waMessageId: summary.waMessageId },
          {
            jobId,
            attempts: 5,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: { count: 5_000 },
            removeOnFail: { count: 5_000 },
          }
        );
      } catch (err: any) {
        // BullMQ: se jobId já existe, é ok (idempotência).
        const msgText = typeof err?.message === "string" ? err.message : "";
        if (msgText.includes("Job") && msgText.includes("already exists")) return;
        throw err;
      }
    })
  );

  req.log.info(
    {
      phoneNumberId,
      waAccountId: waAccount.id,
      messagesCount: messages.length,
      statusesCount: statuses.length,
    },
    "WA event persisted/enqueued"
  );

  // ACK rápido sempre
  return reply.code(200).send("OK");
});

// 3) Endpoint interno de envio (para Motor 2 / worker / integrações internas)
app.post("/wa/send", async (req, reply) => {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey) {
    req.log.error("INTERNAL_API_KEY is not configured");
    return reply.code(500).send({ error: "Server misconfigured" });
  }

  const headerKey = req.headers["x-internal-key"];
  if (typeof headerKey !== "string" || headerKey !== configuredKey) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const body = req.body as any;
  const type = typeof body?.type === "string" ? body.type : undefined;
  const to = typeof body?.to === "string" ? body.to : undefined;

  const waAccountId =
    typeof body?.waAccountId === "string" ? body.waAccountId : undefined;
  const phoneNumberId =
    typeof body?.phoneNumberId === "string" ? body.phoneNumberId : undefined;

  if (!type || !to) {
    return reply
      .code(400)
      .send({ error: "Missing required fields: type, to" });
  }

  try {
    if (type === "text") {
      const text = typeof body?.text === "string" ? body.text : undefined;
      if (!text) return reply.code(400).send({ error: "Missing text" });

      const res = await sendMessage({
        type: "text",
        waAccountId,
        phoneNumberId,
        to,
        text,
      });
      return reply.code(200).send(res);
    }

    if (type === "template") {
      const name = typeof body?.template?.name === "string" ? body.template.name : undefined;
      const languageCode =
        typeof body?.template?.languageCode === "string"
          ? body.template.languageCode
          : undefined;
      const components = body?.template?.components;

      if (!name || !languageCode) {
        return reply
          .code(400)
          .send({ error: "Missing template.name or template.languageCode" });
      }

      const res = await sendMessage({
        type: "template",
        waAccountId,
        phoneNumberId,
        to,
        template: { name, languageCode, components },
      });
      return reply.code(200).send(res);
    }

    return reply.code(400).send({ error: `Unsupported type: ${type}` });
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : "Send failed";
    req.log.error({ msg }, "WA send failed");
    return reply.code(502).send({ error: msg });
  }
});

app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });


