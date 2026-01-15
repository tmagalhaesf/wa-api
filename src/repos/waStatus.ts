import { query } from "../db.js";

export type WaStatus = {
  id: string;
  wa_account_id: string;
  wa_message_id: string;
  recipient_id: string | null;
  status: string;
  status_timestamp: string | null;
  payload: unknown;
  created_at: string;
};

export type InsertWaStatusInput = {
  waAccountId: string;
  waMessageId: string;
  recipientId?: string;
  status: string;
  statusTimestamp?: Date;
  payload: unknown;
};

export async function insertWaStatus(input: InsertWaStatusInput) {
  const res = await query<Pick<WaStatus, "id">>(
    `
    insert into public.wa_status (
      wa_account_id,
      wa_message_id,
      recipient_id,
      status,
      status_timestamp,
      payload
    ) values ($1, $2, $3, $4, $5, $6)
    on conflict (
      wa_account_id,
      wa_message_id,
      status,
      recipient_id,
      status_timestamp
    ) do nothing
    returning id
    `,
    [
      input.waAccountId,
      input.waMessageId,
      input.recipientId ?? null,
      input.status,
      input.statusTimestamp ? input.statusTimestamp.toISOString() : null,
      JSON.stringify(input.payload),
    ]
  );
  return res.rows[0]?.id ?? null;
}


