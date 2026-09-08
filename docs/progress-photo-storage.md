# Progress photo storage

Set PROGRESS_PHOTOS_BUCKET and AWS_REGION on the API host. Use a dedicated private S3 bucket with Block Public Access enabled, bucket-owner-enforced object ownership, default AES256 encryption, and versioning disabled. Do not use a bucket with Object Lock or a retention policy that prevents deletion. The application deletes objects permanently; enabling versioning would retain old versions and break that contract.

The EC2 instance role needs s3:PutObject, s3:GetObject and s3:DeleteObject on this bucket's progress/* objects. No browser receives AWS credentials. Uploads pass through the authenticated API, which verifies ownership, decodes the image, removes metadata and stores a bounded JPEG. Viewing/export uses an authenticated request to obtain a URL valid for 60 seconds. No public ACLs or CORS configuration are needed. Avoid access logs that capture signed query strings.

Database exports contain check-in notes, dates and photo identifiers; export each image from its check-in. Images are never passed to meal parsing or any AI service. Weight and waist summaries are recomputed from corrected logs and remain original observations rather than automated coaching.

Check-in/photo mutations and account deletion share a per-account database lock. Object deletion must succeed before the matching database rows are removed, so a storage outage is retryable. Failed uploads retain a non-ready photo row for cleanup on retry or deletion. Use an unversioned bucket to ensure replacement/deletion does not retain hidden prior copies.

Provisioned stack: `macrovana-progress-photos` in `us-east-2`. Bucket: `macrovana-progress-931115508693-us-east-2`. The release workflow supplies these non-secret environment values. The existing EC2 instance role receives only object read/write/delete access through this stack. Local synthetic-image verification passed upload, signed download and permanent deletion.
