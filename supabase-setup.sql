-- Synergy POS browser-demo setup.
-- Run this entire file in Supabase SQL Editor before enabling cloud sync.

create table if not exists public.menu (
  id bigint primary key,
  name text not null,
  category text not null default 'Mains',
  station text not null default 'Kitchen',
  price numeric(12, 2) not null default 0,
  stock integer not null default 0,
  emoji text not null default '',
  image text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key,
  number integer not null,
  table_number integer,
  type text not null default 'Dine-in',
  guests integer not null default 1,
  status text not null default 'new',
  items jsonb not null default '[]'::jsonb,
  staff text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at text not null default '',
  paid_at text not null default '',
  payment text not null default '',
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0
);

create table if not exists public.settings (
  id text primary key,
  company_name text not null default 'Synergy',
  company_logo text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.menu enable row level security;
alter table public.orders enable row level security;
alter table public.settings enable row level security;
alter table public.pos_state enable row level security;

drop policy if exists "POS demo access menu" on public.menu;
create policy "POS demo access menu" on public.menu
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "POS demo access orders" on public.orders;
create policy "POS demo access orders" on public.orders
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "POS demo access settings" on public.settings;
create policy "POS demo access settings" on public.settings
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "POS demo access state" on public.pos_state;
create policy "POS demo access state" on public.pos_state
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.menu to anon, authenticated;
grant select, insert, update, delete on public.orders to anon, authenticated;
grant select, insert, update, delete on public.settings to anon, authenticated;
grant select, insert, update, delete on public.pos_state to anon, authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['menu', 'orders', 'settings', 'pos_state'] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end
$$;