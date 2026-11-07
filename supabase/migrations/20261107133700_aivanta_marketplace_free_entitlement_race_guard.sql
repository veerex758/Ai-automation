-- Make free-product entitlement creation race-safe.
-- The install RPC checks for an existing free entitlement, but concurrent installs
-- can pass that check simultaneously. NULL purchase_id is not covered by the
-- foundation's composite UNIQUE constraint, so enforce one free grant per user/product.
create unique index if not exists marketplace_entitlements_one_free_per_user_product
 on public.marketplace_entitlements(user_id,product_id)
 where entitlement_type='free' and purchase_id is null;
