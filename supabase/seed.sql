-- Seed mínimo para Motor 1 (WhatsApp Gateway)

-- 1) Workspace default
insert into public.workspaces (slug, name)
values ('default', 'Default')
on conflict (slug) do nothing;

-- 2) wa_account inicial (preencher com seus valores reais)
-- Substitua 'SEU_PHONE_NUMBER_ID' e opcionalmente display_phone_number / waba_id.
-- insert into public.wa_accounts (workspace_id, phone_number_id, display_phone_number, waba_id)
-- select id, 'SEU_PHONE_NUMBER_ID', 'SEU_DISPLAY_PHONE', 'SEU_WABA_ID'
-- from public.workspaces
-- where slug = 'default'
-- on conflict (phone_number_id) do nothing;


