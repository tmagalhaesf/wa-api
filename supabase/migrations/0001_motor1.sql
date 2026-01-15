-- Motor 1 (WhatsApp Gateway) - schema mínimo
-- Safe to run multiple times (usa IF NOT EXISTS e índices com nomes fixos)

create extension if not exists pgcrypto;

-- =========================
-- workspaces
-- =========================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspaces_slug_uq'
  ) then
    alter table public.workspaces
      add constraint workspaces_slug_uq unique (slug);
  end if;
end $$;

-- =========================
-- wa_accounts (mapeia phone_number_id -> workspace)
-- =========================
create table if not exists public.wa_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,

  phone_number_id text not null,
  waba_id text,
  display_phone_number text,
  graph_api_version text,

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists wa_accounts_phone_number_id_uq
  on public.wa_accounts(phone_number_id);

create index if not exists wa_accounts_workspace_id_idx
  on public.wa_accounts(workspace_id);

-- =========================
-- wa_messages (inbound/outbound + payload completo)
-- =========================
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  wa_account_id uuid not null references public.wa_accounts(id) on delete cascade,

  direction text not null,
  wa_message_id text not null,

  -- resumo/normalização
  from_number text,
  to_number text,
  message_type text,
  text_body text,
  media_id text,
  message_timestamp timestamptz,

  payload jsonb not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wa_messages_direction_chk'
  ) then
    alter table public.wa_messages
      add constraint wa_messages_direction_chk
      check (direction in ('in', 'out'));
  end if;
end $$;

create unique index if not exists wa_messages_account_direction_wamid_uq
  on public.wa_messages(wa_account_id, direction, wa_message_id);

create index if not exists wa_messages_account_created_idx
  on public.wa_messages(wa_account_id, created_at desc);

create index if not exists wa_messages_account_from_idx
  on public.wa_messages(wa_account_id, from_number);

-- =========================
-- wa_status (delivered/read/failed etc)
-- =========================
create table if not exists public.wa_status (
  id uuid primary key default gen_random_uuid(),
  wa_account_id uuid not null references public.wa_accounts(id) on delete cascade,

  wa_message_id text not null,
  recipient_id text,
  status text not null,
  status_timestamp timestamptz,

  payload jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists wa_status_dedupe_uq
  on public.wa_status(wa_account_id, wa_message_id, status, recipient_id, status_timestamp);

create index if not exists wa_status_account_msg_idx
  on public.wa_status(wa_account_id, wa_message_id);

-- =========================
-- wa_processed_inbound (idempotência do worker)
-- =========================
create table if not exists public.wa_processed_inbound (
  wa_account_id uuid not null references public.wa_accounts(id) on delete cascade,
  wa_message_id text not null,

  status text not null default 'processing',
  attempts int not null default 0,
  locked_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),

  primary key (wa_account_id, wa_message_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wa_processed_inbound_status_chk'
  ) then
    alter table public.wa_processed_inbound
      add constraint wa_processed_inbound_status_chk
      check (status in ('processing', 'done', 'failed'));
  end if;
end $$;


