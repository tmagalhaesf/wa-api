export type InboundMessageSummary = {
  waMessageId: string;
  fromNumber?: string;
  messageType: string;
  textBody?: string;
  mediaId?: string;
  messageTimestamp?: Date;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseMetaTimestampSeconds(ts: unknown): Date | undefined {
  const s = typeof ts === "string" ? ts : typeof ts === "number" ? String(ts) : undefined;
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n * 1000);
}

export function extractInboundMessageSummary(message: any): InboundMessageSummary | null {
  try {
    const waMessageId = asString(message?.id);
    const messageType = asString(message?.type);
    if (!waMessageId || !messageType) return null;

    const fromNumber = asString(message?.from);
    const messageTimestamp = parseMetaTimestampSeconds(message?.timestamp);

    let textBody: string | undefined;
    let mediaId: string | undefined;

    switch (messageType) {
      case "text":
        textBody = asString(message?.text?.body);
        break;
      case "image":
        mediaId = asString(message?.image?.id);
        textBody = asString(message?.image?.caption);
        break;
      case "audio":
        mediaId = asString(message?.audio?.id);
        break;
      case "video":
        mediaId = asString(message?.video?.id);
        textBody = asString(message?.video?.caption);
        break;
      case "document":
        mediaId = asString(message?.document?.id);
        textBody = asString(message?.document?.caption) ?? asString(message?.document?.filename);
        break;
      case "sticker":
        mediaId = asString(message?.sticker?.id);
        break;
      case "button":
        textBody = asString(message?.button?.text);
        break;
      case "interactive":
        textBody =
          asString(message?.interactive?.button_reply?.title) ??
          asString(message?.interactive?.list_reply?.title) ??
          "[interactive]";
        break;
      case "location": {
        const lat = message?.location?.latitude;
        const lng = message?.location?.longitude;
        const name = asString(message?.location?.name);
        const address = asString(message?.location?.address);
        const parts = [
          name,
          address,
          Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `${lat},${lng}` : undefined,
        ].filter(Boolean);
        textBody = parts.length ? parts.join(" | ") : "[location]";
        break;
      }
      case "contacts": {
        const first = message?.contacts?.[0];
        const name = asString(first?.name?.formatted_name) ?? asString(first?.name?.first_name);
        textBody = name ? `contacts: ${name}` : "contacts";
        break;
      }
      default:
        // Não quebrar para tipos novos (reaction, order, system, etc)
        textBody = `[${messageType}]`;
        break;
    }

    return {
      waMessageId,
      fromNumber,
      messageType,
      textBody,
      mediaId,
      messageTimestamp,
    };
  } catch {
    return null;
  }
}


