# Deployment Guide — Agent Chat UI

This guide explains how to build, push, and deploy the app with environment variables, secrets, and multi-environment support (production and develop).

---

## Prerequisites

- **Google Cloud SDK** (`gcloud`) installed, authenticated, and project selected
- **Docker with Buildx** (macOS M1/M2 users: Buildx is essential for building amd64 images)
- **GCS bucket** for file uploads
- **LangGraph deployment** (LangSmith hosted or self-hosted)
- **Secrets** configured in Secret Manager (see below)

---

## Environment Overview

| Environment | Tag | Traffic | URL Pattern |
|-------------|-----|---------|-------------|
| **Production** | `latest` | 100% | `https://agent-chat-ui-55487246974.asia-south1.run.app` |
| **Develop** | `develop` | 0% | `https://develop---agent-chat-ui-6duluzey3a-el.a.run.app` |

Each environment can have its own image with different build-time variables (like `NEXT_PUBLIC_API_URL`).

---

## Environment Variables Reference

There are three types of configuration in this app:

1. **Build-Time Variables** — Baked into the Docker image, cannot be changed after build
2. **Runtime Variables** — Set in Cloud Run, can be changed without rebuilding
3. **Secrets** — Sensitive values stored in Google Secret Manager, injected at runtime

---

### Build-Time Variables (passed as `--build-arg`)

These are baked into the Docker image at build time. **`NEXT_PUBLIC_*` variables are exposed to the browser** and must be set at build time — they cannot be changed at runtime because Next.js inlines them into the JavaScript bundle during the build process.

> ⚠️ **Important**: If you need to change any `NEXT_PUBLIC_*` variable, you must rebuild and redeploy the Docker image.

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Frontend's API base URL. Points directly to your LangGraph deployment. | `https://questioncrafter-a13b34cfbfc25c1084843165f9c71db7.us.langgraph.app` |
| `NEXT_PUBLIC_ASSISTANT_ID` | LangGraph assistant ID to use in the UI. | `o3_question_crafter_agent` |
| `NEXT_PUBLIC_AUTH_MODE` | Optional auth mode. Set to `iap` to enable IAP-backed JWT flow and hide the API key UI. | `iap` |
| `NEXT_PUBLIC_MODEL_PROVIDER` | `OPENAI` or `GOOGLE` — controls client-side behavior. | `OPENAI` |
| `NEXT_PUBLIC_AGENT_RECURSION_LIMIT` | Max agent recursion depth (defaults to 50). | `50` |

The Dockerfile accepts these as build args and sets them during the build.

---

### Runtime Variables (passed via `--set-env-vars`)

These are set when deploying to Cloud Run and can be changed without rebuilding the image. They are **server-side only** and not exposed to the browser.

In Cloud Run Console: **Service → Edit & Deploy New Revision → Variables & Secrets → Environment Variables**

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `IAP_AUDIENCE` | IAP signed header JWT audience for the frontend service. | **Yes** (if using IAP) | - |
| `LANGGRAPH_AUTH_JWT_ISSUER` | Issuer claim for LangGraph JWTs minted by `/api/auth/token`. | **Yes** (if using IAP) | - |
| `LANGGRAPH_AUTH_JWT_AUDIENCE` | Audience claim for LangGraph JWTs minted by `/api/auth/token`. | **Yes** (if using IAP) | - |
| `MODEL_PROVIDER` | Server-side provider (`OPENAI` or `GOOGLE`). Controls PDF handling behavior. | **Yes** | - |
| `GCS_BUCKET_NAME` | GCS bucket name for file storage/uploads. | **Yes** | - |
| `NEXT_PUBLIC_MODEL_PROVIDER` | Duplicated at runtime for server-side access. | No | - |
| `OPENAI_FILES_PURPOSE` | OpenAI Files API purpose parameter. | No | `assistants` |
| `OPENAI_FILES_EXPIRES_AFTER_ANCHOR` | Expiry anchor for OpenAI files. | No | `created_at` |
| `OPENAI_FILES_EXPIRES_AFTER_SECONDS` | File expiry in seconds (~30 days = 2592000). | No | `7776000` |

---

### Secrets (passed via `--set-secrets`)

Secrets are stored in **Google Secret Manager** and injected into Cloud Run at runtime. This is more secure than plain environment variables because:

- Secrets are encrypted at rest and in transit
- Access is controlled via IAM
- Secrets are not visible in Cloud Run configuration
- You can rotate secrets without redeploying

In Cloud Run Console: **Service → Edit & Deploy New Revision → Variables & Secrets → Secrets**

| Secret Name | Description | Required |
|-------------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key — required for PDF uploads to OpenAI Files API when `MODEL_PROVIDER=OPENAI`. | When using OpenAI |
| `LANGGRAPH_AUTH_JWT_SECRET` | HMAC secret used to sign LangGraph JWTs in `/api/auth/token`. | **Yes** (if using IAP) |

---

## Secrets Setup

### Create Secrets

```bash
PROJECT_ID=cerebryai
SA="55487246974-compute@developer.gserviceaccount.com"

# Function to create a secret
create_secret() {
  SECRET_NAME=$1
  SECRET_VALUE=$2
  
  # Create secret
  gcloud secrets create $SECRET_NAME \
    --project "$PROJECT_ID" \
    --replication-policy="automatic"
  
  # Add version
  printf %s "$SECRET_VALUE" | gcloud secrets versions add $SECRET_NAME \
    --project "$PROJECT_ID" \
    --data-file=-
  
  # Grant access to Cloud Run service account
  gcloud secrets add-iam-policy-binding $SECRET_NAME \
    --project "$PROJECT_ID" \
    --member "serviceAccount:$SA" \
    --role roles/secretmanager.secretAccessor
}

# Create each secret
create_secret "OPENAI_API_KEY" "sk-..."
create_secret "LANGGRAPH_AUTH_JWT_SECRET" "super-secret"
```

### List Existing Secrets

```bash
gcloud secrets list --project cerebryai
```

### Update a Secret Value

```bash
printf %s "new-value" | gcloud secrets versions add OPENAI_API_KEY \
  --project cerebryai \
  --data-file=-
```

---

## Build and Push

### Initialize Buildx (First Time Only)

```bash
docker buildx create --use --bootstrap --name multiarch || docker buildx use multiarch
```

### Production Build

```bash
IMAGE=gcr.io/cerebryai/question_crafter_agent_ui
TS=$(date -u +%Y%m%d-%H%M%S)

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$IMAGE:$TS" \
  -t "$IMAGE:latest" \
  --build-arg NEXT_PUBLIC_API_URL=https://questioncrafter-a13b34cfbfc25c1084843165f9c71db7.us.langgraph.app \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
  --build-arg NEXT_PUBLIC_AUTH_MODE=iap \
  --build-arg NEXT_PUBLIC_MODEL_PROVIDER=OPENAI \
  --build-arg NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --push .
```

### Develop Build

For the develop environment, use this LangGraph URL:

- `https://ht-giving-pickup-82-5383ffe79596502784b9eede7fffa087.us.langgraph.app`

```bash
IMAGE=gcr.io/cerebryai/question_crafter_agent_ui
TS=$(date -u +%Y%m%d-%H%M%S)

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$IMAGE:develop" \
  -t "$IMAGE:develop-$TS" \
  --build-arg NEXT_PUBLIC_API_URL=https://ht-giving-pickup-82-5383ffe79596502784b9eede7fffa087.us.langgraph.app \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
  --build-arg NEXT_PUBLIC_AUTH_MODE=iap \
  --build-arg NEXT_PUBLIC_MODEL_PROVIDER=OPENAI \
  --build-arg NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --push .
```

### Faster Cloud Run Build (amd64-only)

When you only target **Cloud Run** (which uses amd64), you can speed up builds by skipping multi-arch:

```bash
IMAGE=gcr.io/cerebryai/question_crafter_agent_ui
TS=$(date -u +%Y%m%d-%H%M%S)

docker buildx build \
  --platform linux/amd64 \
  -t "$IMAGE:develop" \
  -t "$IMAGE:develop-$TS" \
  --build-arg NEXT_PUBLIC_API_URL=https://ht-giving-pickup-82-5383ffe79596502784b9eede7fffa087.us.langgraph.app \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
  --build-arg NEXT_PUBLIC_AUTH_MODE=iap \
  --build-arg NEXT_PUBLIC_MODEL_PROVIDER=OPENAI \
  --build-arg NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --push .
```

### Verify Multi-Arch Manifest

```bash
docker buildx imagetools inspect "gcr.io/cerebryai/question_crafter_agent_ui:latest"
```

> ⚠️ **Warning**: Never use plain `docker push` from M1/M2 Macs — it overwrites the multi-arch manifest and causes Cloud Run errors.

---

## Deploy to Cloud Run

For an existing service, deploy a pinned image digest with `--no-traffic` first, preserving its runtime/IAP configuration. Set only the environment-specific OpenAI secret reference with `--update-secrets OPENAI_API_KEY=OPENAI_API_KEY_DEV:latest` for develop or `OPENAI_API_KEY_PROD:latest` for production. Public build arguments must also target the corresponding LangGraph environment; a develop image must not be promoted as a production image.

Validate the develop tag, then a production candidate tag. Promote the exact verified production revision using `--to-revisions=REVISION_NAME=100`, preserving the develop tag and recording the prior production revision for rollback. Avoid `LATEST` when different environments share this service. Cloud Build can build the Dockerfile remotely using the same build arguments when local storage is limited.

### Production Deployment (Full Traffic)

```bash
gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui:latest \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "IAP_AUDIENCE=/projects/55487246974/locations/asia-south1/services/agent-chat-ui,LANGGRAPH_AUTH_JWT_ISSUER=agent-chat-ui-frontend-a8b6a18a,LANGGRAPH_AUTH_JWT_AUDIENCE=question_crafter-backend-a8b6a18a,MODEL_PROVIDER=OPENAI,GCS_BUCKET_NAME=question_crafter_public,NEXT_PUBLIC_MODEL_PROVIDER=OPENAI,NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50,OPENAI_FILES_PURPOSE=assistants,OPENAI_FILES_EXPIRES_AFTER_ANCHOR=created_at,OPENAI_FILES_EXPIRES_AFTER_SECONDS=2592000" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY_PROD:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
```

> ⚠️ **Important — Verify traffic after deploy**: `gcloud run deploy` may report a stale revision as "serving 100%" if the new image has the same digest as an existing revision (Cloud Run deduplicates revisions by image content). Always verify after deploying:

```bash
# Check which revision is actually receiving traffic
gcloud run services describe agent-chat-ui --region asia-south1 \
  --format="yaml(status.traffic)"

# If traffic is NOT on the latest revision, shift it manually
gcloud run services update-traffic agent-chat-ui \
  --region asia-south1 \
  --to-revisions=LATEST=100
```

### Develop Deployment (Zero Traffic + Tag)

Deploy for testing without affecting production:

```bash
gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui:develop \
  --region asia-south1 \
  --platform managed \
  --no-traffic \
  --tag develop \
  --set-env-vars "IAP_AUDIENCE=/projects/55487246974/locations/asia-south1/services/agent-chat-ui,LANGGRAPH_AUTH_JWT_ISSUER=agent-chat-ui-frontend-a8b6a18a,LANGGRAPH_AUTH_JWT_AUDIENCE=question_crafter-backend-a8b6a18a,MODEL_PROVIDER=OPENAI,GCS_BUCKET_NAME=question_crafter_public,NEXT_PUBLIC_MODEL_PROVIDER=OPENAI,NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50,OPENAI_FILES_PURPOSE=assistants,OPENAI_FILES_EXPIRES_AFTER_ANCHOR=created_at,OPENAI_FILES_EXPIRES_AFTER_SECONDS=2592000" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY_DEV:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
```

### Develop Deployment (Pinned Image Example)

```bash
gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui:develop-20260203-082603 \
  --region asia-south1 \
  --platform managed \
  --no-traffic \
  --tag develop \
  --set-env-vars "IAP_AUDIENCE=/projects/55487246974/locations/asia-south1/services/agent-chat-ui,LANGGRAPH_AUTH_JWT_ISSUER=agent-chat-ui-frontend-a8b6a18a,LANGGRAPH_AUTH_JWT_AUDIENCE=question_crafter-backend-a8b6a18a,MODEL_PROVIDER=OPENAI,GCS_BUCKET_NAME=question_crafter_public,NEXT_PUBLIC_MODEL_PROVIDER=OPENAI,NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50,OPENAI_FILES_PURPOSE=assistants,OPENAI_FILES_EXPIRES_AFTER_ANCHOR=created_at,OPENAI_FILES_EXPIRES_AFTER_SECONDS=2592000" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY_DEV:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
```

Access at: `https://develop---agent-chat-ui-6duluzey3a-el.a.run.app`

---

## Traffic Management

### View Current Revisions

```bash
gcloud run revisions list --service agent-chat-ui --region asia-south1 --limit 10
```

### View Traffic Split

```bash
gcloud run services describe agent-chat-ui --region asia-south1 --format="yaml(status.traffic)"
```

### Add a Tag to a Revision

```bash
gcloud run services update-traffic agent-chat-ui \
  --region asia-south1 \
  --set-tags develop=agent-chat-ui-00024-cqj
```

### Shift Traffic to a Revision

```bash
# 100% to a specific revision
gcloud run services update-traffic agent-chat-ui \
  --region asia-south1 \
  --to-revisions=agent-chat-ui-00024-cqj=100

# Gradual rollout (e.g., 10% to new, 90% to old)
gcloud run services update-traffic agent-chat-ui \
  --region asia-south1 \
  --to-revisions=agent-chat-ui-00024-cqj=10,agent-chat-ui-00022-8wr=90
```

### Rollback to Previous Revision

```bash
gcloud run services update-traffic agent-chat-ui \
  --region asia-south1 \
  --to-revisions=agent-chat-ui-00022-8wr=100
```

---

## Troubleshooting

### Check Revision Configuration

```bash
gcloud run revisions describe REVISION_NAME --region asia-south1 --format="yaml(spec.containers[0].env)"
```

### View Logs

```bash
gcloud run logs read --service agent-chat-ui --region asia-south1 --limit 50
```

### Common Issues

| Error | Cause | Fix |
|-------|-------|-----|
| `exec format error` | Wrong architecture | Use `docker buildx build` with `--platform linux/amd64,linux/arm64` |
| `Failed to connect to LangGraph server` | Missing `NEXT_PUBLIC_API_URL` build arg or invalid IAP/JWT config | Rebuild with correct `NEXT_PUBLIC_API_URL` and verify `IAP_AUDIENCE` / `LANGGRAPH_AUTH_JWT_*` |
| `error getting credentials` | Docker not authenticated | Run `gcloud auth configure-docker gcr.io` |
| `gcloud crashed (AttributeError)` | Conflicting gcloud installations | Remove old `~/google-cloud-sdk` and use Homebrew version |

---

## GCS Bucket Access

- With Uniform Bucket-Level Access (UBLA), do not set object ACLs
- For public previews, grant `Storage Object Viewer` to `allUsers` via bucket IAM
- The app returns both `gs://` and `https://storage.googleapis.com/<bucket>/<object>` URLs

## Daily-budget release (2026-10-08 IST)

Runtime source `ca5faf6684e4249be5d3a9f031b4a7131fea67c1` is pushed to `codex/user-cost-limits`. Cloud Build `6718459b-fd73-4810-aa84-4f045c29d8c3` in `us-east1` succeeded with separately compiled development and production API endpoints.

| Environment | Cloud Run revision | Image digest | Routing |
| --- | --- | --- | --- |
| Development | `agent-chat-ui-used-meter-dev-1008` | `sha256:25bc708fd804e7155721fce88cc785dd78ed89557be72c59368a70d3a54836cc` | `develop` tag, 0% canonical traffic |
| Production | `agent-chat-ui-used-meter-prod-1008` | `sha256:e8a0b2f9b0234eae23167e4ff23f55f39396a54dcc48eb38d30921bf0bb72941` | 100% canonical traffic |

Both images are in `us-east1-docker.pkg.dev/cerebryai/question-crafter-user-limits/ui`. The Cloud Run service is `agent-chat-ui`, project `cerebryai`, region `asia-south1`. Development was verified first; production was staged at zero traffic and checked Ready before promotion. IAP remains enabled, recursion limit remains 50, and 2 CPU / 2 GiB resources are unchanged. Development references `OPENAI_API_KEY_DEV:latest`; production references `OPENAI_API_KEY_PROD:latest`. Existing JWT secret references remain unchanged. No credential values or local environment files were read for this release.

Authenticated Safari acceptance passed at the development tag and at [the canonical production origin](https://agent-chat-ui-55487246974.asia-south1.run.app). Both displayed the current balance as `$5 left of $5` and `0% used` in the final two-line tooltip. Production used a fresh tab, preserving the existing unsent draft. No real agent messages were submitted during UI acceptance. Use the canonical long production URL: the shorter Cloud Run alias and candidate tags are not backend CORS origins.

Validation: production build with integrated lint/type checks passed. The complete 22-scenario notification, budget and navigator suite passed before the final copy/arc refinement; all four affected final budget scenarios passed afterward, including genuine mobile touch, hover/focus, delayed IST rollover and 0/30/49/50/74/75/100-percent SVG/colour assertions. Desktop/mobile screenshots were reviewed. Existing lint and build warnings remain. Local fixture tests and hosted authenticated read checks are distinct; the hosted UI suite was not run through automated IAP login.

Rollback target is `agent-chat-ui-nav-36a3ccc-prod-0908`:

```bash
gcloud run services update-traffic agent-chat-ui \
  --project cerebryai --region asia-south1 \
  --to-revisions agent-chat-ui-nav-36a3ccc-prod-0908=100
```

The backend admission repair and quota/extra-credit API acceptance are tracked in the QuestionCrafterAgent and user-limit monitoring repositories.


## Attachment-limit release (2026-10-08 IST)

Runtime source `15f6f1c93409ab0f6dc4ab531723a73699007bb7` was merged through PR #7 as `597dcb865b3e19506b651a7e0e07f4749fbe0383`. Both have the exact tree `b5737de2d03a2483da794b717d02e45fa19d6d87`; `main` and `develop` were synchronized before deployment. Cloud Build `65de961b-e75c-49d5-ae18-c598ccd40b28` succeeded with separately compiled development/production API endpoints.

| Environment | Cloud Run revision | Image digest |
| --- | --- | --- |
| Development | `agent-chat-ui-attachments-dev-1008` | `sha256:3ce63867afce41c4e395404d2137b5b463f8b637e85e14a639c8d3a04082102a` |
| Production | `agent-chat-ui-attachments-prod-1008` | `sha256:70d462169e7ff5d60a35f72e93e144cc6b23710b6d74311331f44191ab2527e1` |

Images remain in `us-east1-docker.pkg.dev/cerebryai/question-crafter-user-limits/ui`; service/project/region remain `agent-chat-ui` / `cerebryai` / `asia-south1`. The release preserves IAP, 2 CPU / 2 GiB, the 100MB per-file limit, and OpenAI/GCS upload behavior. Development uses `OPENAI_API_KEY_DEV:latest`; production uses `OPENAI_API_KEY_PROD:latest`; the existing JWT secret reference is preserved.

Validation: `pnpm lint`, production build with integrated type checking, explicit TypeScript check, and all 26 deterministic attachment/budget/navigation Playwright scenarios passed. Existing baseline lint warnings and the build-only nuqs/localStorage warning remain. A 390px mobile screenshot was visually reviewed. Local tests mocked storage/model calls. Authenticated development acceptance verified the visible independent counters and rejection of three synthetic PDFs before upload, with zero attachments retained and Send disabled. The complete automated suite ran locally; hosted acceptance was exercised through Safari.

Rollback: `gcloud run services update-traffic agent-chat-ui --project cerebryai --region asia-south1 --to-revisions agent-chat-ui-used-meter-prod-1008=100`. This preserves the prior deployed production UI.

Release outcome: the development tag remains on `agent-chat-ui-attachments-dev-1008` at 0% canonical traffic; production `agent-chat-ui-attachments-prod-1008` is Ready/ContainerHealthy and receives 100%. Authenticated canonical production acceptance confirmed the new 0/20-image and 0/2-PDF counters plus the existing budget display. A production native-picker rejection attempt was inconclusive because Safari kept its Upload button disabled for the synthetic fixture selection; it was canceled without transferring files. The corresponding hosted development rejection passed. No generation requests were submitted, and existing user thread tabs were preserved.


## Combined PDF page budget (2026-10-08 IST)

The runtime requires Poppler `pdfinfo`. The Alpine runner installs `poppler-utils` and executes `pdfinfo -v` during the image build, so a missing binary fails the build. No new environment variables or credentials are required. Local development must install Poppler as described in README.

The existing Cloud Run IAP perimeter protects the same-origin count-only multipart endpoint `/api/upload/pdf-pages`. It accepts up to two PDFs, counts actual bytes through a private temporary file with a 10-second subprocess timeout, 64KiB output bound and finally cleanup, and rejects more than 64 pages combined. It does not write to GCS, OpenAI or another parser service. The two existing upload routes also enforce actual-byte per-file validation before external uploads. Aggregate validation before a model run is additionally owned by the QuestionCrafter backend; client counts are not an authorization boundary.

PR #8 merged tested runtime source `bf51fb3bbdca30eb174fbbee51aa1f01683f6e7c` as `89efa8c9d817e8e7f03c5f324984e990ce71b1af`; both have tree `6759f3bd94d06fe7ae1a3363b7c85e56dd5ff39e`. Initial Cloud Build `1256256e-c34c-4e77-85b2-6d9fe3337494` in `us-east1`, project `cerebryai`, was canceled before deployment after the HTTP/1 preflight refinement; Cloud Run remains in `asia-south1`. The rollback target before this change is `agent-chat-ui-attachments-prod-1008`.

Local validation: production build, repository lint and TypeScript passed (existing baseline warnings only). All 38 deterministic attachment/parser/budget/navigation checks passed; the final build and 16 focused tests passed again after the seekable-file optimization. Real 64/65-page, encrypted/malformed/spoofed PDF fixtures, 32+33/32+32 admission, all three input paths, concurrent and reset cases, failed/restored/unknown metadata, actionable backend errors and no-provider-upload direct-route checks are covered. The 390px full-budget screenshot was visually reviewed.


Transport constraint: the deployed service uses HTTP/1, and Cloud Run limits each request to 32MiB (including multipart overhead). The existing 100MiB application file limit does not override that transport cap. The UI sends each PDF in its own count request, so two individually uploadable files do not become one oversized preflight body. It still combines both server-derived page counts before any storage/provider upload. Files above the infrastructure request cap remain an existing limitation; this release does not change transport or upload architecture. See [Cloud Run quotas](https://docs.cloud.google.com/run/quotas).

Performance scope: preflight sends PDF bytes to the UI server separately from the later accepted storage upload. Local parser CPU/wall measurements exclude that network transfer and are not end-to-end upload timings. Counting is local, uses no model tokens, and rejected selections never reach storage/provider upload.


Page-budget staging source: PR #9 refined preflight transport as `b20943e830191adfb89e87367107f4315a608db0`, merged as `a7e19cf83fec3d48c09fb047a6f900669f69c09a`; both have tree `edd6ed357879aa3ea953d8b4236ae3d4fbd8a6ef`. Cloud Build `368e5ce6-d38a-4cfb-b4b2-17b204b90ba9` (`us-east1`, project `cerebryai`) succeeded at 2026-10-08 00:00:21 UTC. Both runners reported `pdfinfo version 25.12.0`. The singleton-preflight build, lint and all 16 focused tests passed.

| Environment | Revision | Image digest |
| --- | --- | --- |
| Development | `agent-chat-ui-pdf-pages-dev-1008` | `sha256:d97dc4c901213e5a7862e021867c688d629f25cfcf3fc24c3cb9dfb43cd93682` |
| Production image (not deployed) | — | `sha256:db6f50e3e811ee6293bbfad41f7743780ad6e4182dd019a47b4d81ed2fb3b0da` |

Image repository: `us-east1-docker.pkg.dev/cerebryai/question-crafter-user-limits/ui`. Development was Ready/ContainerHealthy at zero canonical traffic; production promotion was held for the receipt enhancement below.


### Reusable verified PDF page counts

Uploaded PDF responses and native file metadata include `page_count` and, when signing is configured and GCS generation is available, `page_count_receipt`. The source HTTPS URL is pinned to the actual immutable GCS generation returned by `save()`; no additional metadata request is needed. The receipt binds that exact URL and optional returned OpenAI file ID to the server-counted pages. The alternate OpenAI upload route issues a receipt only for canonical generation-pinned GCS input. Plain counts, mutable URLs and arbitrary client tokens are never signed as authoritative input.

The existing `LANGGRAPH_AUTH_JWT_SECRET` signs HS256 receipts with fixed issuer `agent-chat-ui/pdf-page-count`, audience `questioncrafter/pdf-page-count`, purpose `pdf-page-count`, version 1 and a 30-day expiry. This audience cannot be used for normal authentication. No new key/configuration is introduced; missing keys or invalid/expired receipts preserve the backend's count-from-bytes fallback. The composer exposes PAGE_COUNT in ATTACHMENTS_INFO while keeping the JWT out of model-readable text. Receipts remain in native metadata and can be reused by backend tools for the same immutable source.

The earlier page-budget development revision was staged successfully, but production promotion was held for this metadata optimization. Final receipt-aware release identities and acceptance scope are recorded below.


Receipt release source: tested `baa71bdab39b9cf97bd03fc7b1451b6d32626835`, merged in PR #10 as `8374d10af771b55eb14198f5129338f6685d2b1b`; both have tree `a393b7b75a5edfecd8beba9357ec4d7038e823ab`. Final dual-image build: `ddd24dd2-acdd-4038-a291-30664c58a559`, project `cerebryai`, Cloud Build region `us-east1`.

Receipt validation: final production build, lint, TypeScript and formatting passed; 40 full-suite scenarios and one additional focused URL/OpenAI-ID metadata scenario passed. Restoration preserves the receipt, ATTACHMENTS_INFO contains PAGE_COUNT only, claimed client counts are ignored by the upload signer, and a fixture produced by Node jose passed the actual Python PyJWT verifier with identical URL/generation/file-ID bindings. These checks use synthetic keys and mocked storage/provider writes. A real hosted storage/provider upload is outside release acceptance; no generation request is sent.


| Environment | Final revision | Image digest | Traffic |
| --- | --- | --- | --- |
| Development | `agent-chat-ui-pdf-receipt-dev-1008` | `sha256:33b9faffe7b1ed92481ea43cc6fdd1994a022707ca60827586694b635ed75cf1` | `develop` tag; 0% canonical |
| Production | `agent-chat-ui-pdf-receipt-prod-1008` | `sha256:a04f5cc4b003fc3768089207e440b649d9a1884c129a6f03eb37c9666b50e597` | 100% canonical |

Final build succeeded at 2026-10-08 00:17:21 UTC. Both images report Poppler 25.12.0. Develop was deployed first; production was staged at zero traffic and promoted only after the backend receipt commit `45f16711d7fb92bb6e3f2ca41127f5cb8c8650ce` was confirmed active/DEPLOYED in both API environments. Final Cloud Run checks confirm exact image digests, Ready and ContainerHealthy for both revisions, IAP enabled, unchanged 2CPU/2GiB/HTTP1, environment-specific OPENAI_API_KEY_DEV/PROD references, and the existing shared JWT-secret reference. The prior production and budget tags remain available. Rollback remains `agent-chat-ui-attachments-prod-1008`.

Hosted upload acceptance is **unverified** for this release: native Safari automation reported active user interaction and was stopped without changing or uploading content; the existing test auth-state HTTP check redirected to sign-in (302), and no test bearer was configured. No hosted count request, real storage/provider upload or model generation was submitted. This limitation is separate from the passing local route/browser/receipt tests and verified Cloud Run deployment health. Synthetic Node-to-Python signature interoperability passed; real upload receipt issuance was tested with mocked storage/provider boundaries.

Local evidence: `test-results/attachment-limits-mobile.png` (390px, 64/64 pages), `/tmp/ui-page-receipt-build.log`, and `/tmp/ui-pdf-receipt-release-evidence.json` (safe deployment fields only). The final documentation-only commit does not change the tested/built runtime source and does not require rebuilding images.
