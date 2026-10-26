-- Pegar en Supabase → SQL Editor → Run (una sola vez).

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  monto numeric(14, 2) not null check (monto > 0),
  categoria text not null,
  fecha date not null default current_date,
  metodo text not null default 'Débito',
  nota text,
  created_at timestamptz not null default now()
);

create index if not exists gastos_user_fecha_idx on public.gastos (user_id, fecha desc);

-- Seguridad por filas: cada usuario solo ve y modifica sus propios gastos.
alter table public.gastos enable row level security;

create policy "ver mis gastos" on public.gastos
  for select using ((select auth.uid()) = user_id);

create policy "crear mis gastos" on public.gastos
  for insert with check ((select auth.uid()) = user_id);

create policy "editar mis gastos" on public.gastos
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "borrar mis gastos" on public.gastos
  for delete using ((select auth.uid()) = user_id);
