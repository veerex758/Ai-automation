begin;
select plan(2);
select has_trigger('public','marketplace_products','marketplace_product_customer_trust_notice','product status and version changes notify installed customers');
select has_trigger('public','marketplace_product_versions','marketplace_version_revocation_notice','version revocation fans out emergency pause');
select * from finish();
rollback;
