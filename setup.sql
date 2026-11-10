-- 길드 주간 비밸 관리 사이트 테이블
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하면 돼요. (여러 번 실행해도 안전)

create table if not exists go_admins (
  email text primary key,
  role  text not null default 'manager' check (role in ('master','manager')),
  created_at timestamptz not null default now()
);

create table if not exists go_members (
  id bigint generated always as identity primary key,
  nickname text not null unique,
  active boolean not null default true,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists go_weeks (
  id bigint generated always as identity primary key,
  start_date date not null unique,
  title text,
  buffs text,
  created_at timestamptz not null default now()
);

create table if not exists go_accounts (            -- 길드원 밑의 게임 계정 (본캐·부캐)
  id bigint generated always as identity primary key,
  member_id bigint not null references go_members(id) on delete cascade,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists go_specs (
  id bigint generated always as identity primary key,
  week_id bigint not null references go_weeks(id) on delete cascade,
  account_id bigint not null references go_accounts(id) on delete cascade,
  member_id bigint references go_members(id) on delete cascade,
  slots jsonb not null,            -- [{hp,atk,def,img}] × 3  (1번용 · 2번용 · 3번용)
  total bigint not null default 0, -- 세 마리 비밸 합
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint go_specs_week_account_key unique (week_id, account_id)
);

create table if not exists go_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  action text,
  detail text
);

-- 관리자 판별
create or replace function go_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from go_admins where lower(email) = lower(coalesce(auth.jwt()->>'email','')));
$$;
create or replace function go_is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from go_admins where lower(email) = lower(coalesce(auth.jwt()->>'email','')) and role = 'master');
$$;

alter table go_admins  enable row level security;
alter table go_members enable row level security;
alter table go_weeks   enable row level security;
alter table go_accounts enable row level security;
alter table go_specs   enable row level security;
alter table go_logs    enable row level security;

-- 랭킹은 누구나 보기 / 쓰기는 관리자만
do $$
declare t text;
begin
  foreach t in array array['go_members','go_accounts','go_weeks','go_specs'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (true)', t);
    execute format('create policy %1$s_write on %1$s for all to authenticated using (go_is_admin()) with check (go_is_admin())', t);
  end loop;
end $$;

drop policy if exists go_admins_self on go_admins;
drop policy if exists go_admins_master on go_admins;
create policy go_admins_self on go_admins for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt()->>'email','')) or go_is_master());
create policy go_admins_master on go_admins for all to authenticated
  using (go_is_master()) with check (go_is_master());

drop policy if exists go_logs_insert on go_logs;
drop policy if exists go_logs_read on go_logs;
create policy go_logs_insert on go_logs for insert to authenticated with check (go_is_admin());
create policy go_logs_read on go_logs for select to authenticated using (go_is_master());

-- 처음 설정: 관리자가 아무도 없을 때만 사이트에서 마스터 계정을 만들 수 있게
create or replace function go_needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists(select 1 from go_admins);
$$;
create or replace function go_bootstrap() returns text
language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if e = '' then raise exception 'login required'; end if;
  if exists(select 1 from go_admins) then raise exception 'already set up'; end if;
  insert into go_admins(email, role) values (e, 'master');
  return e;
end $$;
grant execute on function go_needs_setup() to anon, authenticated;
grant execute on function go_bootstrap() to authenticated;

-- 그 다음: Authentication → Sign In / Providers 에서 가입 허용 ON, Email 의 Confirm email OFF
-- 사이트 #/login 에 들어가면 '처음 설정' 화면에서 마스터 아이디/비밀번호를 만들 수 있어요.
