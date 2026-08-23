-- Run this in the Supabase SQL editor (Project -> SQL Editor).
-- Image bytes go in Storage. This table only stores metadata and the storage path.

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relative_path text,
  size_bytes bigint,
  content_type text,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.images enable row level security;

drop policy if exists "anon can read images" on public.images;
drop policy if exists "anon can insert images" on public.images;

create policy "anon can read images"
  on public.images
  for select
  to anon
  using (true);

create policy "anon can insert images"
  on public.images
  for insert
  to anon
  with check (true);

insert into storage.buckets (id, name, public)
values ('source-images', 'source-images', false)
on conflict (id) do nothing;

drop policy if exists "anon can upload source images" on storage.objects;
drop policy if exists "anon can read source images" on storage.objects;

create policy "anon can upload source images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'source-images');

create policy "anon can read source images"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'source-images');
