/**
 * Writes an uploaded topic .json to Google Cloud Storage, exactly the way the chat's /api/upload
 * writes its files: a new `Storage()` client with the service's own credentials, one simple
 * (non-resumable) upload, and no object ACLs. Public read comes from the bucket's IAM policy
 * (Uniform Bucket-Level Access), so the returned https link works without signing.
 *
 * Kept apart from the handler so tests can swap the write for a fake.
 */
import { Storage } from "@google-cloud/storage";

export interface TopicJsonObject {
  bucket: string;
  /** `topic-ingest/<uuid>.json` */
  objectName: string;
  body: Buffer;
  contentType: string;
}

export type SaveTopicJson = (object: TopicJsonObject) => Promise<void>;

export const saveTopicJson: SaveTopicJson = async ({
  bucket,
  objectName,
  body,
  contentType,
}) => {
  const storage = new Storage();
  await storage.bucket(bucket).file(objectName).save(body, {
    contentType,
    resumable: false,
    // Do not set object ACLs when Uniform Bucket-Level Access is enabled.
    // Public readability is configured at the bucket IAM policy.
  });
};
