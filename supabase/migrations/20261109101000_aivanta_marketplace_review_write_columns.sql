-- Limit customer writes to review content and notice read acknowledgement only.
revoke update on public.marketplace_product_reviews from authenticated;
grant update(rating,title,body,updated_at) on public.marketplace_product_reviews to authenticated;
revoke update on public.marketplace_customer_notices from authenticated;
grant update(read_at) on public.marketplace_customer_notices to authenticated;
