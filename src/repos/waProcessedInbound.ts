import { query } from "../db.js";

export type WaProcessedInbound = {
  wa_account_id: string;
  wa_message_id: string;
  status: "processing" | "done" | "failed";
  attempts: number;
  locked_at: string;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export async function beginInboundProcessing(params: {
  waAccountId: string;
  waMessageId: string;
}) {
  // Se já está DONE, não retorna nada (worker deve ignorar).
  const res = await query<Pick<WaProcessedInbound, "status" | "attempts">>(
    `
    insert into public.wa_processed_inbound (
      wa_account_id,
      wa_message_id,
      status,
      attempts,
      locked_at,
      last_error
    ) values ($1, $2, 'processing', 1, now(), null)
    on conflict (wa_account_id, wa_message_id) do update
      set status = 'processing',
          attempts = public.wa_processed_inbound.attempts + 1,
          locked_at = now(),
          last_error = null
      where public.wa_processed_inbound.status <> 'done'
    returning status, attempts
    `,
    [params.waAccountId, params.waMessageId]
  );

  return res.rows[0] ?? null;
}

export async function markInboundDone(params: {
  waAccountId: string;
  waMessageId: string;
}) {
  await query(
    `
    update public.wa_processed_inbound
      set status = 'done',
          processed_at = now(),
          last_error = null
    where wa_account_id = $1
      and wa_message_id = $2
    `,
    [params.waAccountId, params.waMessageId]
  );
}

export async function markInboundFailed(params: {
  waAccountId: string;
  waMessageId: string;
  lastError: string;
}) {
  await query(
    `
    update public.wa_processed_inbound
      set status = 'failed',
          last_error = $3
    where wa_account_id = $1
      and wa_message_id = $2
    `,
    [params.waAccountId, params.waMessageId, params.lastError]
  );
}


