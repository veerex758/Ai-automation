# Provider OAuth setup

The generic OAuth authorization routes are:

- Start: /api/integrations/oauth/{provider}/start
- Callback: /api/integrations/oauth/{provider}/callback

Register the exact callback URL for each provider in its developer console. The callback origin must match the Aivanta deployment origin used to start authorization.

All generic provider flows require AIVANTA_OAUTH_STATE_SECRET (at least 32 characters) and the existing AIVANTA_CREDENTIALS_ENCRYPTION_KEY. Provider client secrets stay in server environment variables; they are never written into workspace credentials.

| Provider | Client ID environment variable | Client secret environment variable |
|---|---|---|
| Microsoft Teams | AIVANTA_MICROSOFT_TEAMS_CLIENT_ID | AIVANTA_MICROSOFT_TEAMS_CLIENT_SECRET |
| Salesforce | AIVANTA_SALESFORCE_CLIENT_ID | AIVANTA_SALESFORCE_CLIENT_SECRET |
| Pipedrive | AIVANTA_PIPEDRIVE_CLIENT_ID | AIVANTA_PIPEDRIVE_CLIENT_SECRET |
| Zoho CRM | AIVANTA_ZOHO_CRM_CLIENT_ID | AIVANTA_ZOHO_CRM_CLIENT_SECRET |
| Intercom | AIVANTA_INTERCOM_CLIENT_ID | AIVANTA_INTERCOM_CLIENT_SECRET |
| Asana | AIVANTA_ASANA_CLIENT_ID | AIVANTA_ASANA_CLIENT_SECRET |
| Todoist | AIVANTA_TODOIST_CLIENT_ID | AIVANTA_TODOIST_CLIENT_SECRET |
| Bitbucket | AIVANTA_BITBUCKET_CLIENT_ID | AIVANTA_BITBUCKET_CLIENT_SECRET |
| X | AIVANTA_X_TWITTER_CLIENT_ID | AIVANTA_X_TWITTER_CLIENT_SECRET |
| LinkedIn | AIVANTA_LINKEDIN_CLIENT_ID | AIVANTA_LINKEDIN_CLIENT_SECRET |
| Facebook Pages | AIVANTA_FACEBOOK_PAGE¶»§q«^