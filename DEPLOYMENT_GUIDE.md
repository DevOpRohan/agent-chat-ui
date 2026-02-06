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

### Production Deployment (Full Traffic)

```bash
gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui:latest \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "\
IAP_AUDIENCE=/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME,\
LANGGRAPH_AUTH_JWT_ISSUER=https://your-company.example,\
LANGGRAPH_AUTH_JWT_AUDIENCE=https://your-langgraph.example,\
MODEL_PROVIDER=OPENAI,\
GCS_BUCKET_NAME=question_crafter_public,\
NEXT_PUBLIC_MODEL_PROVIDER=OPENAI,\
NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50,\
OPENAI_FILES_PURPOSE=assistants,\
OPENAI_FILES_EXPIRES_AFTER_ANCHOR=created_at,\
OPENAI_FILES_EXPIRES_AFTER_SECONDS=2592000" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
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
  --set-env-vars "\
IAP_AUDIENCE=/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME,\
LANGGRAPH_AUTH_JWT_ISSUER=https://your-company.example,\
LANGGRAPH_AUTH_JWT_AUDIENCE=https://your-langgraph.example,\
MODEL_PROVIDER=OPENAI,\
GCS_BUCKET_NAME=question_crafter_public,\
NEXT_PUBLIC_MODEL_PROVIDER=OPENAI,\
NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50,\
OPENAI_FILES_PURPOSE=assistants,\
OPENAI_FILES_EXPIRES_AFTER_ANCHOR=created_at,\
OPENAI_FILES_EXPIRES_AFTER_SECONDS=2592000" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
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
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest,LANGGRAPH_AUTH_JWT_SECRET=LANGGRAPH_AUTH_JWT_SECRET:latest"
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
