create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) <= 160),
  phone text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, email)
);

create table if not exists public.payment_links (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAID', 'PAUSED')),
  created_at timestamptz not null default now()
);

create table if not exists public.charges (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payment_link_id text references public.payment_links(id) on delete set null,
  identifier text not null,
  provider_transaction_id text,
  customer_name text not null,
  customer_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  payment_method text not null default 'PIX' check (payment_method in ('PIX', 'CARD', 'BOLETO')),
  status text not null check (status in ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CHARGED_BACK', 'EXPIRED', 'CANCELED')),
  pix_copy_paste text,
  pix_image_url text,
  pix_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, identifier)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  charge_id text not null references public.charges(id) on delete cascade,
  title text not null,
  type text not null check (type in ('RECEIPT', 'PAYMENT_CONFIRMATION')),
  created_at timestamptz not null default now()
);

create table if not exists public.payflow_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists customers_user_created_idx on public.customers(user_id, created_at desc);
create index if not exists payment_links_user_created_idx on public.payment_links(user_id, created_at desc);
create index if not exists charges_user_created_idx on public.charges(user_id, created_at desc);
create index if not exists charges_status_created_idx on public.charges(user_id, status, created_at desc);
create index if not exists documents_user_created_idx on public.documents(user_id, created_at desc);

alter table public.customers enable row level security;
alter table public.payment_links enable row level security;
alter table public.charges enable row level security;
alter table public.documents enable row level security;
alter table public.payflow_operators enable row level security;

revoke all on public.payflow_operators from anon, authenticated;

create or replace function public.is_payflow_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payflow_operators
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_payflow_operator() from public;
grant execute on function public.is_payflow_operator() to authenticated;

create policy "Operators manage their own customers"
  on public.customers for all to authenticated
  using (public.is_payflow_operator() and user_id = (select auth.uid()))
  with check (public.is_payflow_operator() and user_id = (select auth.uid()));

create policy "Operators manage their own payment links"
  on public.payment_links for all to authenticated
  using (public.is_payflow_operator() and user_id = (select auth.uid()))
  with check (public.is_payflow_operator() and user_id = (select auth.uid()));

create policy "Operators read their own charges"
  on public.charges for select to authenticated
  using (public.is_payflow_operator() and user_id = (select auth.uid()));

create policy "Operators read their own documents"
  on public.documents for select to authenticated
  using (public.is_payflow_operator() and user_id = (select auth.uid()));

create policy "Operators create documents for their own charges"
  on public.documents for insert to authenticated
  with check (
    public.is_payflow_operator()
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.charges
      where charges.id = documents.charge_id
        and charges.user_id = (select auth.uid())
        and charges.status = 'COMPLETED'
    )
  );

grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.payment_links to authenticated;
grant select on public.charges to authenticated;
grant select, insert on public.documents to authenticated;