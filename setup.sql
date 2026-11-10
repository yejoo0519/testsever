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

create table if not exists go_specs (
  id bigint generated always as identity primary key,
  week_id bigint not null references go_weeks(id) on delete cascade,
  member_id bigint not null references go_members(id) on delete cascade,
  slots jsonb not null,            -- [{hp,atk,def,img}] × 3  (1번용 · 2번용 · 3번용)
  total bigint not null default 0, -- 세 마리 비밸 합
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (week_id, member_id)
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
alter table go_specs   enable row level security;
alter table go_logs    enable row level security;

-- 랭킹은 누구나 보기 / 쓰기는 관리자만
do $$
declare t text;
begin
  foreach t in array array['go_members','go_weeks','go_specs'] loop
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

-- ▼ 첫 마스터 계정: Authentication → Users → Add user 로 만든 이메일을 넣고 실행
-- insert into go_admins(email, role) values ('여기에_이메일', 'master') on conflict (email) do update set role = 'master';
