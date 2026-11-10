insert into storage.buckets (id, name, public)
values ('characterization-images', 'characterization-images', false)
on conflict (id) do update set public = false;

create table public.characterization_reports (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  original_name text not null,
  original_path text not null,
  overlay_path text not null,
  overlay_style text not null,
  flipped boolean,
  best_group integer not null,
  best_element integer not null,
  lp_per_mm double precision not null,
  resolution_mm double precision not null,
  image_width integer not null,
  image_height integer not null,
  result jsonb not null,
  constraint report_storage_paths check (
    original_path like user_id::text || '/' || id::text || '/original.%'
    and overlay_path = user_id::text || '/' || id::text || '/overlay.png'
  )
);

create index characterization_reports_user_created_idx
  on public.characterization_reports (user_id, created_at desc);

alter table public.characterization_reports enable row level security;
revoke all on public.characterization_reports from anon, authenticated;
grant select, insert on public.characterization_reports to authenticated;

create policy "Read own characterization reports"
  on public.characterization_reports for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Insert own characterization reports"
  on public.characterization_reports for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Upload own characterization images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'characterization-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Read own characterization images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'characterization-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Delete own characterization images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'characterization-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
