-- Economic foundation v1. Requires lpa_registry_core; not provider fulfillment.
begin;
create table lpa_private.wallets(
 account_id uuid primary key references auth.users(id) on delete restrict,
 currency text not null default 'LPA' check(currency='LPA'),
 balance bigint not null default 0 check(balance between 0 and 1000000000000),
 version bigint not null default 0 check(version>=0),
 status text not null default 'active' check(status in ('active','blocked')),
 economy_enabled boolean not null default false
);
create table lpa_private.items(
 game_id text not null references lpa_private.games(game_id),
 item_id text not null check(item_id ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
 kind text not null check(kind in ('consumable','permanent')),
 primary key(game_id,item_id),unique(game_id,item_id,kind)
);
create table lpa_private.products(
 product_id text primary key check(product_id ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
 game_id text not null,item_id text not null,
 active boolean not null default true,current_price_version integer not null default 1,
 foreign key(game_id,item_id) references lpa_private.items(game_id,item_id)
);
create table lpa_private.prices(
 product_id text not null references lpa_private.products(product_id),
 price_version integer not null check(price_version>0),
 units bigint not null check(units between 1 and 1000000000),
 quantity integer not null check(quantity between 1 and 1000000),
 title text not null check(length(title) between 1 and 120),
 created_at timestamptz not null default now(),primary key(product_id,price_version)
);
alter table lpa_private.products add constraint products_current_price foreign key(product_id,current_price_version)
 references lpa_private.prices(product_id,price_version) deferrable initially deferred;
create table lpa_private.ledger(
 operation_id uuid primary key default gen_random_uuid(),
 account_id uuid not null references lpa_private.wallets(account_id) on delete restrict,
 units bigint not null check(units<>0 and units between -1000000000000 and 1000000000000),
 source_kind text not null check(source_kind in ('paid','ad','earned','store','reversal')),
 source_namespace text not null check(length(source_namespace) between 1 and 150),
 source_id text not null check(length(source_id) between 1 and 200),
 request_payload jsonb not null,receipt jsonb not null,
 reversal_of uuid references lpa_private.ledger(operation_id) on delete restrict,
 recorded_at timestamptz not null default now(),unique(source_namespace,source_id)
);
create index ledger_account_time on lpa_private.ledger(account_id,recorded_at,operation_id);
create table lpa_private.credit_lots(
 lot_id uuid primary key default gen_random_uuid(),
 account_id uuid not null references lpa_private.wallets(account_id),
 credit_operation_id uuid not null unique references lpa_private.ledger(operation_id),
 provenance text not null check(provenance in ('paid','ad','earned')),
 credited bigint not null check(credited between 1 and 1000000000000),
 remaining bigint not null check(remaining between 0 and credited),created_at timestamptz not null default now()
);
create index credit_lots_account on lpa_private.credit_lots(account_id,created_at,lot_id);
create table lpa_private.debit_allocations(
 debit_operation_id uuid not null references lpa_private.ledger(operation_id),
 lot_id uuid not null references lpa_private.credit_lots(lot_id),
 units bigint not null check(units>0),primary key(debit_operation_id,lot_id)
);
create table lpa_private.inventory_grants(
 grant_id uuid primary key default gen_random_uuid(),account_id uuid not null references lpa_private.wallets(account_id),
 game_id text not null,item_id text not null,kind text not null,quantity integer not null check(quantity>0),
 source_operation_id uuid not null unique references lpa_private.ledger(operation_id),
 created_at timestamptz not null default now(),
 foreign key(game_id,item_id,kind) references lpa_private.items(game_id,item_id,kind),
 check(kind<>'permanent' or quantity=1),unique(grant_id,account_id,game_id,item_id)
);
create table lpa_private.entitlements(
 account_id uuid not null,game_id text not null,item_id text not null,grant_id uuid not null,
 primary key(account_id,game_id,item_id),
 foreign key(grant_id,account_id,game_id,item_id) references lpa_private.inventory_grants(grant_id,account_id,game_id,item_id)
);
create table lpa_private.store_orders(
 account_id uuid not null references lpa_private.wallets(account_id),request_id uuid not null,
 purchase_id uuid not null unique,request_payload jsonb not null,receipt jsonb not null,
 operation_id uuid unique references lpa_private.ledger(operation_id),
 primary key(account_id,request_id),created_at timestamptz not null default now()
);
create table lpa_private.economy_audit(
 audit_id uuid primary key default gen_random_uuid(),actor_role text not null,action text not null,
 account_id uuid,reason text not null check(length(reason) between 1 and 500),details jsonb not null,
 created_at timestamptz not null default now()
);

create function lpa_private.immutable_row() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'immutable_record' using errcode='55000'; end; $$;
create function lpa_private.product_identity_fixed() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.product_id,new.game_id,new.item_id) is distinct from (old.product_id,old.game_id,old.item_id) then raise exception 'immutable_product_identity' using errcode='55000'; end if;
 return new;
end; $$;
create trigger product_identity_fixed before update on lpa_private.products for each row execute function lpa_private.product_identity_fixed();
do $$ declare tab text; begin
 foreach tab in array array['ledger','debit_allocations','inventory_grants','entitlements','store_orders','prices','items','economy_audit'] loop
  execute format('create trigger immutable_row before update or delete on lpa_private.%I for each row execute function lpa_private.immutable_row()',tab);
 end loop;
 foreach tab in array array['wallets','items','products','prices','ledger','credit_lots','debit_allocations','inventory_grants','entitlements','store_orders','economy_audit'] loop
  execute format('alter table lpa_private.%I enable row level security',tab);
  execute format('revoke all on lpa_private.%I from public,anon,authenticated,service_role',tab);
 end loop;
end; $$;

-- Backend catalog/control operations. Never grant these to client roles.
create function lpa_private.register_product(p_game_id text,p_item_id text,p_kind text,p_product_id text,p_title text,p_price bigint,p_quantity integer,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_kind='permanent' and p_quantity<>1 then raise exception 'invalid_quantity'; end if;
 insert into lpa_private.items(game_id,item_id,kind) values(p_game_id,p_item_id,p_kind) on conflict do nothing;
 if not exists(select 1 from lpa_private.items where game_id=p_game_id and item_id=p_item_id and kind=p_kind) then raise exception 'item_kind_conflict'; end if;
 insert into lpa_private.products(product_id,game_id,item_id) values(p_product_id,p_game_id,p_item_id);
 insert into lpa_private.prices(product_id,price_version,units,quantity,title) values(p_product_id,1,p_price,p_quantity,p_title);
 insert into lpa_private.economy_audit(actor_role,action,reason,details) values(current_setting('role'),'register_product',p_reason,jsonb_build_object('productId',p_product_id));
end; $$;
create function lpa_private.reprice_product(p_product_id text,p_price bigint,p_quantity integer,p_reason text,p_title text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare prod lpa_private.products; ver integer; item_kind text; offer_title text;
begin
 select * into prod from lpa_private.products where product_id=p_product_id for update;
 if not found then raise exception 'product_unavailable'; end if;
 select kind into item_kind from lpa_private.items where game_id=prod.game_id and item_id=prod.item_id;
 if item_kind='permanent' and p_quantity<>1 then raise exception 'invalid_quantity'; end if;
 ver:=prod.current_price_version+1;
 select title into offer_title from lpa_private.prices where product_id=p_product_id and price_version=prod.current_price_version;
 insert into lpa_private.prices(product_id,price_version,units,quantity,title) values(p_product_id,ver,p_price,p_quantity,coalesce(p_title,offer_title));
 update lpa_private.products set current_price_version=ver where product_id=p_product_id;
 insert into lpa_private.economy_audit(actor_role,action,reason,details) values(current_setting('role'),'reprice_product',p_reason,jsonb_build_object('productId',p_product_id,'version',ver));
 return ver;
end; $$;
create function lpa_private.set_account_controls(p_account_id uuid,p_enabled boolean,p_status text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into lpa_private.wallets(account_id) values(p_account_id) on conflict do nothing;
 perform 1 from lpa_private.wallets where account_id=p_account_id for update;
 update lpa_private.wallets set economy_enabled=p_enabled,status=p_status where account_id=p_account_id;
 insert into lpa_private.economy_audit(actor_role,action,account_id,reason,details) values(current_setting('role'),'account_controls',p_account_id,p_reason,jsonb_build_object('enabled',p_enabled,'status',p_status));
end; $$;
create function lpa_private.set_game_economy(p_game_id text,p_enabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update lpa_private.games set economy_enabled=p_enabled where game_id=p_game_id;
 if not found then raise exception 'game_unavailable'; end if;
 insert into lpa_private.economy_audit(actor_role,action,reason,details) values(current_setting('role'),'game_economy',p_reason,jsonb_build_object('gameId',p_game_id,'enabled',p_enabled));
end; $$;
create function lpa_private.set_product_active(p_product_id text,p_active boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update lpa_private.products set active=p_active where product_id=p_product_id;
 if not found then raise exception 'product_unavailable'; end if;
 insert into lpa_private.economy_audit(actor_role,action,reason,details) values(current_setting('role'),'product_active',p_reason,jsonb_build_object('productId',p_product_id,'active',p_active));
end; $$;

-- Caller is a trusted backend AFTER provider/rule validation, never the browser.
-- Not a webhook verifier: no client callback, redirect or ad_completed is accepted.
create function lpa_private.record_verified_credit(p_account_id uuid,p_namespace text,p_source_id text,p_kind text,p_units bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w lpa_private.wallets; old lpa_private.ledger; op uuid:=gen_random_uuid(); payload jsonb; receipt jsonb;
begin
 if p_kind='earned' then raise exception 'accepted_branch_required'; end if;
 if p_kind is null or p_kind not in ('paid','ad') or p_units is null or p_units not between 1 and 1000000000000
  or p_namespace is null or p_namespace !~ '^[a-z0-9][a-z0-9_.:-]{0,149}$' or p_namespace='store'
  or p_source_id is null or length(p_source_id) not between 1 and 200 then raise exception 'invalid_credit'; end if;
 payload:=jsonb_build_object('accountId',p_account_id,'kind',p_kind,'units',p_units);
 -- Lock order: source (for credit only), wallet, lots. No outbound calls inside locks.
 perform pg_advisory_xact_lock(hashtextextended(p_namespace||':'||p_source_id,0));
 select * into old from lpa_private.ledger where source_namespace=p_namespace and source_id=p_source_id;
 if found then
  if old.request_payload<>payload then raise exception 'idempotency_conflict'; end if;
  return old.receipt;
 end if;
 insert into lpa_private.wallets(account_id) values(p_account_id) on conflict do nothing;
 select * into w from lpa_private.wallets where account_id=p_account_id for update;
 if w.balance+p_units>1000000000000 then raise exception 'balance_limit'; end if;
 receipt:=jsonb_build_object('operationId',op,'balance',w.balance+p_units,'currency','LPA','walletVersion',w.version+1);
 insert into lpa_private.ledger(operation_id,account_id,units,source_kind,source_namespace,source_id,request_payload,receipt)
 values(op,p_account_id,p_units,p_kind,p_namespace,p_source_id,payload,receipt);
 insert into lpa_private.credit_lots(account_id,credit_operation_id,provenance,credited,remaining) values(p_account_id,op,p_kind,p_units,p_units);
 update lpa_private.wallets set balance=balance+p_units,version=version+1 where account_id=p_account_id;
 return receipt;
end; $$;
grant execute on function lpa_private.register_product(text,text,text,text,text,bigint,integer,text),
 lpa_private.reprice_product(text,bigint,integer,text,text),lpa_private.set_account_controls(uuid,boolean,text,text),
 lpa_private.set_game_economy(text,boolean,text),lpa_private.set_product_active(text,boolean,text),lpa_private.record_verified_credit(uuid,text,text,text,bigint) to service_role;

create function lpa_api.wallet() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=lpa_api.require_actor(); w lpa_private.wallets;
begin
 insert into lpa_private.wallets(account_id) values(actor) on conflict do nothing;
 select * into w from lpa_private.wallets where account_id=actor;
 return jsonb_build_object('balance',w.balance,'currency',w.currency,'walletVersion',w.version,'status',w.status,'economyEnabled',w.economy_enabled);
end; $$;
create function lpa_api.catalog(p_game_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform lpa_api.require_actor();
 if not exists(select 1 from lpa_private.games where game_id=p_game_id and active) then raise exception 'game_unavailable'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.product_id,'gameId',p.game_id,'itemId',p.item_id,'title',v.title,
  'price',v.units,'priceVersion',v.price_version,'kind',i.kind,'quantity',v.quantity) order by p.product_id),'[]'::jsonb)
 from lpa_private.products p join lpa_private.prices v on v.product_id=p.product_id and v.price_version=p.current_price_version
 join lpa_private.items i on i.game_id=p.game_id and i.item_id=p.item_id where p.game_id=p_game_id and p.active);
end; $$;
create function lpa_api.inventory(p_game_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=lpa_api.require_actor(); begin
 if not exists(select 1 from lpa_private.games where game_id=p_game_id) then raise exception 'game_unavailable'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',grant_id,'gameId',game_id,'itemId',item_id,'kind',kind,'quantity',quantity) order by created_at,grant_id),'[]'::jsonb)
  from lpa_private.inventory_grants where account_id=actor and game_id=p_game_id);
end; $$;

create function lpa_api.purchase(p_game_id text,p_product_id text,p_request_id uuid,p_price_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=lpa_api.require_actor(); w lpa_private.wallets; prod lpa_private.products; price lpa_private.prices;
 old lpa_private.store_orders; item_kind text; grant_row lpa_private.inventory_grants; lot lpa_private.credit_lots;
 payload jsonb; receipt jsonb; op uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid(); need bigint; take bigint;
begin
 if p_request_id is null then raise exception 'request_id_required'; end if;
 if p_price_version is null then raise exception 'price_quote_required'; end if;
 payload:=jsonb_build_object('gameId',p_game_id,'productId',p_product_id,'priceVersion',p_price_version);
 insert into lpa_private.wallets(account_id) values(actor) on conflict do nothing;
 select * into w from lpa_private.wallets where account_id=actor for update;
 select * into old from lpa_private.store_orders where account_id=actor and request_id=p_request_id;
 if found then
  if old.request_payload<>payload then raise exception 'idempotency_conflict'; end if;
  return old.receipt;
 end if;
 if w.status<>'active' then raise exception 'account_blocked'; end if;
 if not w.economy_enabled then raise exception 'economy_disabled'; end if;
 perform 1 from lpa_private.games where game_id=p_game_id and active for share;
 if not found then raise exception 'game_unavailable'; end if;
 if not exists(select 1 from lpa_private.games where game_id=p_game_id and economy_enabled) then raise exception 'economy_disabled'; end if;
 -- Shared product lock makes quote/control edits wait until purchase completes.
 select * into prod from lpa_private.products where product_id=p_product_id and game_id=p_game_id and active for share;
 if not found then raise exception 'product_unavailable'; end if;
 if prod.current_price_version<>p_price_version then raise exception 'price_changed'; end if;
 select * into price from lpa_private.prices where product_id=prod.product_id and price_version=p_price_version;
 select kind into item_kind from lpa_private.items where game_id=prod.game_id and item_id=prod.item_id;
 if item_kind='permanent' then
  select g.* into grant_row from lpa_private.entitlements e join lpa_private.inventory_grants g on g.grant_id=e.grant_id
   where e.account_id=actor and e.game_id=prod.game_id and e.item_id=prod.item_id;
 end if;
 if grant_row.grant_id is not null then
  receipt:=jsonb_build_object('purchaseId',purchase,'gameId',p_game_id,'productId',p_product_id,'priceVersion',p_price_version,'status','already_owned','balance',w.balance,'currency','LPA','walletVersion',w.version,
   'grant',jsonb_build_object('id',grant_row.grant_id,'gameId',grant_row.game_id,'itemId',grant_row.item_id,'kind',grant_row.kind,'quantity',grant_row.quantity));
  insert into lpa_private.store_orders(account_id,request_id,purchase_id,request_payload,receipt) values(actor,p_request_id,purchase,payload,receipt);
  return receipt;
 end if;
 if w.balance<price.units then raise exception 'insufficient_funds'; end if;
 grant_row.grant_id:=gen_random_uuid();
 receipt:=jsonb_build_object('purchaseId',purchase,'gameId',p_game_id,'productId',p_product_id,'priceVersion',p_price_version,'status','purchased','balance',w.balance-price.units,'currency','LPA','walletVersion',w.version+1,
  'grant',jsonb_build_object('id',grant_row.grant_id,'gameId',prod.game_id,'itemId',prod.item_id,'kind',item_kind,'quantity',price.quantity));
 insert into lpa_private.ledger(operation_id,account_id,units,source_kind,source_namespace,source_id,request_payload,receipt)
 values(op,actor,-price.units,'store','store',actor::text||':'||p_request_id::text,payload,receipt);
 need:=price.units;
 -- FIFO prototype allocation; provenance is retained for future reviewed refunds.
 for lot in select * from lpa_private.credit_lots where account_id=actor and remaining>0 order by created_at,lot_id for update loop
  take:=least(need,lot.remaining);
  insert into lpa_private.debit_allocations values(op,lot.lot_id,take);
  update lpa_private.credit_lots set remaining=remaining-take where lot_id=lot.lot_id;
  need:=need-take; exit when need=0;
 end loop;
 if need<>0 then raise exception 'projection_mismatch'; end if;
 insert into lpa_private.inventory_grants(grant_id,account_id,game_id,item_id,kind,quantity,source_operation_id)
 values(grant_row.grant_id,actor,prod.game_id,prod.item_id,item_kind,price.quantity,op);
 if item_kind='permanent' then insert into lpa_private.entitlements values(actor,prod.game_id,prod.item_id,grant_row.grant_id); end if;
 update lpa_private.wallets set balance=balance-price.units,version=version+1 where account_id=actor;
 insert into lpa_private.store_orders(account_id,request_id,purchase_id,request_payload,receipt,operation_id) values(actor,p_request_id,purchase,payload,receipt,op);
 return receipt;
end; $$;

create function lpa_api.capabilities() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=lpa_api.require_actor(); enabled boolean; begin
 select economy_enabled and status='active' into enabled from lpa_private.wallets where account_id=actor;
 return jsonb_build_object('contractVersion',1,'registry',true,'economy',true,'providers',false,'cloudSaves',false,'spendEnabled',coalesce(enabled,false));
end; $$;
create function lpa_api.purchase_status(p_request_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=lpa_api.require_actor(); receipt jsonb; begin
 select o.receipt into receipt from lpa_private.store_orders o where o.account_id=actor and o.request_id=p_request_id;
 return receipt;
end; $$;
grant execute on function lpa_api.purchase_status(uuid) to authenticated;
grant execute on function lpa_api.wallet(),lpa_api.catalog(text),lpa_api.inventory(text),lpa_api.purchase(text,text,uuid,integer),lpa_api.capabilities() to authenticated;
create function public.lpa_wallet() returns jsonb language sql security invoker set search_path='' as $$ select lpa_api.wallet(); $$;
create function public.lpa_catalog(p_game_id text) returns jsonb language sql stable security invoker set search_path='' as $$ select lpa_api.catalog(p_game_id); $$;
create function public.lpa_inventory(p_game_id text) returns jsonb language sql stable security invoker set search_path='' as $$ select lpa_api.inventory(p_game_id); $$;
create function public.lpa_purchase(p_game_id text,p_product_id text,p_request_id uuid,p_price_version integer default null) returns jsonb language sql security invoker set search_path='' as $$ select lpa_api.purchase(p_game_id,p_product_id,p_request_id,p_price_version); $$;
create function public.lpa_capabilities() returns jsonb language sql security invoker set search_path='' as $$ select lpa_api.capabilities(); $$;
create function public.lpa_purchase_status(p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select lpa_api.purchase_status(p_request_id); $$;
revoke all on function public.lpa_purchase_status(uuid) from public,anon;
grant execute on function public.lpa_purchase_status(uuid) to authenticated;
revoke all on function public.lpa_wallet(),public.lpa_catalog(text),public.lpa_inventory(text),public.lpa_purchase(text,text,uuid,integer),public.lpa_capabilities() from public,anon;
grant execute on function public.lpa_wallet(),public.lpa_catalog(text),public.lpa_inventory(text),public.lpa_purchase(text,text,uuid,integer),public.lpa_capabilities() to authenticated;
-- Explicit function ACLs override both global PUBLIC and Supabase public-schema defaults.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('lpa_private','lpa_api') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end; $$;
grant execute on function lpa_private.register_game(text,text,text,text),
 lpa_private.register_product(text,text,text,text,text,bigint,integer,text),
 lpa_private.reprice_product(text,bigint,integer,text,text),lpa_private.set_account_controls(uuid,boolean,text,text),
 lpa_private.set_game_economy(text,boolean,text),lpa_private.set_product_active(text,boolean,text),lpa_private.record_verified_credit(uuid,text,text,text,bigint) to service_role;
grant execute on function lpa_api.require_actor(),lpa_api.games(),lpa_api.wallet(),lpa_api.catalog(text),lpa_api.inventory(text),lpa_api.purchase(text,text,uuid,integer),lpa_api.capabilities(),lpa_api.purchase_status(uuid) to authenticated;
revoke all on function public.lpa_games(),public.lpa_wallet(),public.lpa_catalog(text),public.lpa_inventory(text),public.lpa_purchase(text,text,uuid,integer),public.lpa_capabilities(),public.lpa_purchase_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.lpa_games(),public.lpa_wallet(),public.lpa_catalog(text),public.lpa_inventory(text),public.lpa_purchase(text,text,uuid,integer),public.lpa_capabilities(),public.lpa_purchase_status(uuid) to authenticated;
commit;
