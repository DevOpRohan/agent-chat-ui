# Deployment Guide — Agent Chat UI

This guide explains how to build, push, and deploy the app with the required environment variables and secrets. It also covers multi-architecture images and Cloud Run specifics.

## Prerequisites
- Google Cloud SDK installed (`gcloud`), authenticated, and project selected.
- Docker with Buildx (macOS M1/M2 users: Buildx is essential for building amd64 images).
- GCS bucket for uploads (set `GCS_BUCKET_NAME`).
- Optional: OpenAI API Key (for PDF uploads to OpenAI Files API when `MODEL_PROVIDER=OPENAI`).

## Environment Variables
Server (set at runtime or Cloud Run):
- `GCS_BUCKET_NAME`: GCS bucket name for file storage.
- `MODEL_PROVIDER`: `OPENAI` or `GOOGLE`. Controls server behavior for PDF handling.
- `OPENAI_API_KEY`: required if `MODEL_PROVIDER=OPENAI` and you want PDF uploads to OpenAI Files API.
- Optional OpenAI tuning:
  - `OPENAI_FILES_PURPOSE` (default `assistants`)
  - `OPENAI_FILES_EXPIRES_AFTER_ANCHOR` (default `created_at`)
  - `OPENAI_FILES_EXPIRES_AFTER_SECONDS` (default ~90d `7776000`)

Client (Next public — must be passed at build time):
- `NEXT_PUBLIC_API_URL`: your site’s `/api` base. Example: `https://your-site.run.app/api`.
- `NEXT_PUBLIC_ASSISTANT_ID`: assistant id to use in the UI.
- `NEXT_PUBLIC_MODEL_PROVIDER`: `OPENAI` or `GOOGLE`.
- `NEXT_PUBLIC_AGENT_RECURSION_LIMIT`: optional recursion depth override (defaults to 50).

The Dockerfile already accepts these as build args and sets them during the build.

## GCS Bucket Access
- With Uniform Bucket-Level Access (UBLA), do not set object ACLs. Public previews must be enabled via bucket IAM (grant `Storage Object Viewer` to `allUsers`), or switch to signed URLs.
- The app returns both `gs://` and `https://storage.googleapis.com/<bucket>/<object>` URLs. The HTTPS link is used in previews and attachment summaries.

## OpenAI Secret (Optional)
Create a secret and grant Cloud Run’s service account access.

```
PROJECT_ID=cerebryai
SECRET=OPENAI_API_KEY
VALUE='sk-...'

# Create secret
gcloud secrets create $SECRET \
  --project "$PROJECT_ID" \
  --replication-policy="automatic"

# Add version
printf %s "$VALUE" | gcloud secrets versions add $SECRET \
  --project "$PROJECT_ID" \
  --data-file=-

# Grant Secret Accessor to Cloud Run runtime SA
SA="55487246974-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding $SECRET \
  --project "$PROJECT_ID" \
  --member "serviceAccount:$SA" \
  --role roles/secretmanager.secretAccessor
```


## Build and Push (Multi-Arch)
Use buildx so the image works on both amd64 (Cloud Run) and arm64 (Apple Silicon).

Initialize Buildx (first time only):
```
docker buildx create --use --bootstrap --name multiarch || docker buildx use multiarch
```

Build and push (latest + timestamp tag) with your public envs:
```
IMAGE=gcr.io/cerebryai/question_crafter_agent_ui
TS=$(date -u +%Y%m%d-%H%M%S)

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$IMAGE:$TS" \
  -t "$IMAGE:latest" \
  --build-arg NEXT_PUBLIC_API_URL=https://agent-chat-ui-55487246974.asia-south1.run.app/api \
  --build-arg NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
  --build-arg NEXT_PUBLIC_MODEL_PROVIDER=OPENAI \
  --build-arg NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --push .
```

Verify manifests (should show amd64 and arm64):
```
docker buildx imagetools inspect "$IMAGE:latest"
```

Avoid doing a plain `docker push` from an M1/M2 machine. It can overwrite the multi-arch manifest with a single-arch arm64 image and cause Cloud Run startup errors (exec format error).

## Deploy to Cloud Run
Recommended: deploy by digest (pins the multi-arch index):
```
# Example digest; replace with your current value from imagetools inspect
DIGEST=sha256:5a2c664b24d32b7c78c8ba6d1d8d828e48138512dc08eeb3ae1678d672a846ed

gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui@$DIGEST \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars MODEL_PROVIDER=OPENAI,GCS_BUCKET_NAME=your-bucket,NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest
```

Alternatively, deploy by timestamp tag:
```
gcloud run deploy agent-chat-ui \
  --image gcr.io/cerebryai/question_crafter_agent_ui:20250904-193549 \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars MODEL_PROVIDER=OPENAI,GCS_BUCKET_NAME=your-bucket,NEXT_PUBLIC_AGENT_RECURSION_LIMIT=50 \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest
```
