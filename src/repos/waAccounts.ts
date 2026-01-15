import { query } from "../db.js";

export type WaAccount = {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  waba_id: string | null;
  display_phone_number: string | null;
  graph_api_version: string | null;
  is_active: boolean;
  created_at: string;
};

export async function findWaAccountByPhoneNumberId(phoneNumberId: string) {
  const res = await query<WaAccount>(
    `
    select
      id,
      workspace_id,
      phone_number_id,
      waba_id,
      display_phone_number,
      graph_api_version,
      is_active,
      created_at
    from public.wa_accounts
    where phone_number_id = $1
      and is_active = true
    limit 1
    `,
    [phoneNumberId]
  );
  return res.rows[0] ?? null;
}

export async function findWaAccountById(waAccountId: string) {
  const res = await query<WaAccount>(
    `
    select
      id,
      workspace_id,
      phone_number_id,
      waba_id,
      display_phone_number,
      graph_api_version,
      is_active,
      created_at
    from public.wa_accounts
    where id = $1
      and is_active = true
    limit 1
    `,
    [waAccountId]
  );
  return res.rows[0] ?? null;
}


