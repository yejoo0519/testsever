-- 길드원 밑에 게임 계정(본캐·부캐) 여러 개 — 기존 DB 업데이트용 (여러 번 실행해도 안전)
create table if not exists go_accounts (
  id bigint generated always as identity primary key,
  member_id bigint not null references go_members(id) on delete cascade,
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table go_accounts enable row level security;
drop policy if exists go_accounts_read on go_accounts;
drop policy if exists go_accounts_write on go_accounts;
create policy go_accounts_read on go_accounts for select using (true);
create policy go_accounts_write on go_accounts for all to authenticated using (go_is_admin()) with check (go_is_admin());

-- 지금 있는 길드원마다 같은 이름의 계정 하나씩
insert into go_accounts(member_id, name) select id, nickname from go_members on conflict (name) do nothing;

-- 스펙을 계정 단위로
alter table go_specs add column if not exists account_id bigint references go_accounts(id) on delete cascade;
update go_specs s set account_id = a.id from go_members m, go_accounts a
  where s.account_id is null and m.id = s.member_id and a.member_id = m.id and a.name = m.nickname;
delete from go_specs where account_id is null;
alter table go_specs alter column account_id set not null;
alter table go_specs alter column member_id drop not null;
alter table go_specs drop constraint if exists go_specs_week_id_member_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'go_specs_week_account_key') then
    alter table go_specs add constraint go_specs_week_account_key unique (week_id, account_id);
  end if;
end $$;
notify pgrst, 'reload schema';
