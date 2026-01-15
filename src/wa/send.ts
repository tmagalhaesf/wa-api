import { findWaAccountById, findWaAccountByPhoneNumberId } from "../repos/waAccounts.js";
import { insertOutboundMessage } from "../repos/waMessages.js";

type GraphApiErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type SendTextInput = {
  waAccountId?: string;
  phoneNumberId?: string;
  to: string;
  text: string;
};

export type SendTemplateInput = {
  waAccountId?: string;
  phoneNumberId?: string;
  to: string;
  template: {
    name: string;
    languageCode: string;
    components?: unknown[];
  };
};

export type SendMessageInput =
  | ({ type: "text" } & SendTextInput)
  | ({ type: "template" } & SendTemplateInput);

export type SendMessageResult = {
  waAccountId: string;
  phoneNumberId: string;
  waMessageId: string;
};

function normalizeGraphApiVersion(v: string) {
  return v.startsWith("v") ? v : `v${v}`;
}

async function resolveWaAccount(input: { waAccountId?: string; phoneNumberId?: string }) {
  if (input.waAccountId) return await findWaAccountById(input.waAccountId);
  if (input.phoneNumberId) return await findWaAccountByPhoneNumberId(input.phoneNumberId);
  return null;
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const waAccessToken = process.env.WA_ACCESS_TOKEN;
  if (!waAccessToken) throw new Error("WA_ACCESS_TOKEN is required");

  const waAccount = await resolveWaAccount(input);
  if (!waAccount) throw new Error("WA account not found (waAccountId/phoneNumberId)");

  const graphApiVersion = normalizeGraphApiVersion(
    waAccount.graph_api_version ?? process.env.WA_GRAPH_API_VERSION ?? "v20.0"
  );

  const url = `https://graph.facebook.com/${graphApiVersion}/${waAccount.phone_number_id}/messages`;

  let requestBody: any;
  if (input.type === "text") {
    requestBody = {
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: { body: input.text },
    };
  } else if (input.type === "template") {
    requestBody = {
      messaging_product: "whatsapp",
      to: input.to,
      type: "template",
      template: {
        name: input.template.name,
        language: { code: input.template.languageCode },
        components: input.template.components,
      },
    };
  } else {
    throw new Error("Unsupported message type");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${waAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = json as GraphApiErrorResponse;
    const msg = err?.error?.message ?? "Unknown Graph API error";
    throw new Error(`Graph API error (${res.status}): ${msg}`);
  }

  const waMessageId = json?.messages?.[0]?.id as string | undefined;
  if (!waMessageId) {
    throw new Error("Graph API success but missing messages[0].id");
  }

  await insertOutboundMessage({
    waAccountId: waAccount.id,
    waMessageId,
    toNumber: input.to,
    messageType: input.type,
    textBody: input.type === "text" ? input.text : undefined,
    payload: { request: requestBody, response: json },
  });

  return { waAccountId: waAccount.id, phoneNumberId: waAccount.phone_number_id, waMessageId };
}


