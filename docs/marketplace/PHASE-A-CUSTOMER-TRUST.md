# Marketplace Phase A customer trust completion
Adds customer ratings restricted by RLS to purchasers or users who installed a product, abuse/IP/security/privacy reports, and private per-user notice inbox/read state. Reviewer verification queue remains separate at /api/marketplace/reviews.
- Ratings: GET/POST /api/marketplace/products/:productId/ratings; one review per user/product; 1–5 stars; only published reviews visible; review edits restricted to content columns.
- Reports: POST /api/marketplace/products/:productId/reports; categories abuse, IP, security, privacy, misrepresentation, other; bounded body; duplicate active reports rejected.
- Notices: GET/PATCH /api/marketplace/notices; service-role delivery only, scoped inbox and read acknowledgement.
- Moderation writes remain service-role only. No hosted migration applied.
