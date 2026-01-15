import { Worker } from "bullmq";

import { redisConnection } from "./queue.js";
import { pool } from "./db.js";
import {
  beginInboundProcessing,
  markInboundDone,
  markInboundFailed,
} from "./repos/waProcessedInbound.js";
import { findInboundMessageByWaMessageId } from "./repos/waMessages.js";
import { sendMessage } from "./wa/send.js";

type InboundJobData = {
  waAccountId: string;
  waMessageId: string;
};

const concurrency = Number(process.env.WA_WORKER_CONCURRENCY ?? 5);

const worker = new Worker<InboundJobData>(
  "wa_inbound",
  async (job) => {
    const waAccountId = job.data?.waAccountId;
    const waMessageId = job.data?.waMessageId;
    if (typeof waAccountId !== "string" || typeof waMessageId !== "string") {
      throw new Error("Invalid job payload");
    }

    const claim = await beginInboundProcessing({ waAccountId, waMessageId });
    if (!claim) {
      // já processado (done) => idempotência
      return { skipped: true };
    }

    try {
      const inbound = await findInboundMessageByWaMessageId({ waAccountId, waMessageId });
      if (!inbound) throw new Error("Inbound message not found in DB");

      const to = inbound.from_number;
      if (!to) throw new Error("Inbound message missing from_number");

      // Core stub (MVP): sempre responder
      await sendMessage({
        type: "text",
        waAccountId,
        to,
        text: "Recebi sua mensagem ✅",
      });

      await markInboundDone({ waAccountId, waMessageId });

      console.info(
        JSON.stringify({
          level: "info",
          msg: "Inbound processed",
          waAccountId,
          waMessageId,
          attempts: claim.attempts,
        })
      );

      return { ok: true };
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message : "Unknown error";
      await markInboundFailed({ waAccountId, waMessageId, lastError: msg.slice(0, 500) });

      console.error(
        JSON.stringify({
          level: "error",
          msg: "Inbound processing failed",
          waAccountId,
          waMessageId,
          attempts: claim.attempts,
          error: msg,
        })
      );

      throw err;
    }
  },
  { connection: redisConnection, concurrency }
);

worker.on("failed", (job, err) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "Job failed",
      jobId: job?.id,
      name: job?.name,
      error: err?.message,
    })
  );
});

worker.on("completed", (job) => {
  console.info(
    JSON.stringify({
      level: "info",
      msg: "Job completed",
      jobId: job?.id,
      name: job?.name,
    })
  );
});

async function shutdown(signal: string) {
  console.info(JSON.stringify({ level: "info", msg: "Shutting down", signal }));
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));


