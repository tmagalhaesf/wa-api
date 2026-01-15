import { query } from "../db.js";

export type WaMessageDirection = "in" | "out";

export type WaMessage = {
  id: string;
  wa_account_id: string;
  direction: WaMessageDirection;
  wa_message_id: string;
  from_number: string | null;
  to_number: string | null;
  message_type: string | null;
  text_body: string | null;
  media_id: string | null;
  message_timestamp: string | null;
  payload: unknown;
  created_at: string;
};

export type InsertInboundMessageInput = {
  waAccountId: string;
  waMessageId: string;
  fromNumber?: string;
  messageType?: string;
  textBody?: string;
  mediaId?: string;
  messageTimestamp?: Date;
  payload: unknown;
};

export async function insertInboundMessage(input: InsertInboundMessageInput) {
  const res = await query<Pick<WaMessage, "id">>(
    `
    insert into public.wa_messages (
      wa_account_id,
      direction,
      wa_message_id,
      from_number,
      message_type,
      text_body,
      media_id,
      message_timestamp,
      payload
    ) values ($1, 'in', $2, $3, $4, $5, $6, $7, $8)
    on conflict (wa_account_id, direction, wa_message_id) do nothing
    returning id
    `,
    [
      input.waAccountId,
      input.waMessageId,
      input.fromNumber ?? null,
      input.messageType ?? null,
      input.textBody ?? null,
      input.mediaId ?? null,
      input.messageTimestamp ? input.messageTimestamp.toISOString() : null,
      JSON.stringify(input.payload),
    ]
  );

  return res.rows[0]?.id ?? null;
}

export type InsertOutboundMessageInput = {
  waAccountId: string;
  waMessageId: string;
  toNumber: string;
  messageType?: string;
  textBody?: string;
  mediaId?: string;
  payload: unknown;
};

export async function insertOutboundMessage(input: InsertOutboundMessageInput) {
  const res = await query<Pick<WaMessage, "id">>(
    `
    insert into public.wa_messages (
      wa_account_id,
      direction,
      wa_message_id,
      to_number,
      message_type,
      text_body,
      media_id,
      payload
    ) values ($1, 'out', $2, $3, $4, $5, $6, $7)
    on conflict (wa_account_id, direction, wa_message_id) do nothing
    returning id
    `,
    [
      input.waAccountId,
      input.waMessageId,
      input.toNumber,
      input.messageType ?? null,
      input.textBody ?? null,
      input.mediaId ?? null,
      JSON.stringify(input.payload),
    ]
  );

  return res.rows[0]?.id ?? null;
}

export async function findInboundMessageByWaMessageId(params: {
  waAccountId: string;
  waMessageId: string;
}) {
  const res = await query<WaMessage>(
    `
    select
      id,
      wa_account_id,
      direction,
      wa_message_id,
      from_number,
      to_number,
      message_type,
      text_body,
      media_id,
      message_timestamp,
      payload,
      created_at
    from public.wa_messages
    where wa_account_id = $1
      and direction = 'in'
      and wa_message_id = $2
    limit 1
    `,
    [params.waAccountId, params.waMessageId]
  );

  return res.rows[0] ?? null;
}


