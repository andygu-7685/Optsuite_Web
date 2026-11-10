grant delete on public.characterization_reports to authenticated;

create policy "Delete own characterization reports"
  on public.characterization_reports for delete to authenticated
  using (user_id = (select auth.uid()));
