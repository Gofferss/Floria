-- Проверка миграции 045. Откатывается.
begin;

do $$
begin
  insert into public.bot_panels (chat_id, message_id) values (1, 10);
  insert into public.bot_panels (chat_id, message_id) values (1, 11)
    on conflict (chat_id) do update set message_id = excluded.message_id;
  if (select message_id from public.bot_panels where chat_id = 1) <> 11 then raise exception 'Новая панель не заменила прежнюю'; end if;
  if has_table_privilege('anon', 'public.bot_panels', 'select') or has_table_privilege('authenticated', 'public.bot_panels', 'select') then
    raise exception 'Панели видны снаружи';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.bot_panels'::regclass) then raise exception 'Нет RLS'; end if;
  raise notice 'Одна панель на чат, снаружи не видно';
end $$;

select 'ВСЕ ПРОВЕРКИ 045 ПРОШЛИ' as result;

rollback;
