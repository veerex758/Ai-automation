insert into public.marketplace_categories(slug,name,description,sort_order) values
 ('sales-crm','Sales & CRM','Lead capture, qualification, and customer relationship workflows',10),
 ('marketing','Marketing','Campaigns, content, and audience operations',20),
 ('support','Customer Support','Support triage, ticket routing, and customer care',30),
 ('operations','Operations','Business process automation and internal workflows',40),
 ('data-analytics','Data & Analytics','Reporting, data movement, and analysis',50),
 ('ai-agents','AI Agents','Task-oriented assistants and agent workflows',60),
 ('finance','Finance','Billing, invoicing, and finance operations',70),
 ('productivity','Productivity','Personal and team productivity automations',80),
 ('developer-tools','Developer Tools','Engineering, deployment, and developer workflows',90),
 ('ecommerce','E-commerce','Storefront, orders, and commerce automation',100)
on conflict(slug) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=true;
