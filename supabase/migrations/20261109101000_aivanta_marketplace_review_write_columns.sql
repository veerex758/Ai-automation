-- Tighten customer-controlled review updates to content fields only.
revoke update on public.marketplace_product_reviews from authenticated;
grant update(rating,title,body,updated_at) on public.marketplace_product_reviews to authenticated;
