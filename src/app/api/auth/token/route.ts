import { NextRequest, NextResponse } from "next/server";
import { decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import { getIapPublicKey } from "@/lib/iap-keys";

export const runtime = "nodejs";

const IAP_ISSUER = "https://cloud.google.com/iap";
const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  const assertion = req.headers.get("x-goog-iap-jwt-assertion");
  if (!assertion) {
    return jsonError("Missing IAP JWT assertion", 401);
  }

  const iapAudience = process.env.IAP_AUDIENCE;
  const jwtSecret = process.env.LANGGRAPH_AUTH_JWT_SECRET;
  const jwtIssuer = process.env.LANGGRAPH_AUTH_JWT_ISSUER;
  const jwtAudience = process.env.LANGGRAPH_AUTH_JWT_AUDIENCE;

  if (!iapAudience || !jwtSecret || !jwtIssuer || !jwtAudience) {
    return jsonError("Server auth configuration is incomplete", 500);
  }

  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(assertion) as { alg?: string; kid?: string };
  } catch {
    return jsonError("Invalid IAP JWT header", 403);
  }

  if (header.alg !== "ES256") {
    return jsonError("Invalid IAP JWT algorithm", 403);
  }
  if (!header.kid) {
    return jsonError("Missing IAP JWT key id", 403);
  }

  let payload: Record<string, unknown>;
  try {
    const key = await getIapPublicKey(header.kid);
    const verification = await jwtVerify(assertion, key, {
      issuer: IAP_ISSUER,
      audience: iapAudience,
      algorithms: ["ES256"],
    });
    payload = verification.payload as Record<string, unknown>;
  } catch (error) {
    console.error("IAP JWT verification failed", error);
    return jsonError("Invalid IAP JWT", 403);
  }

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!sub || !email) {
    return jsonError("IAP JWT missing subject or email", 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(jwtSecret));

  return NextResponse.json(
    { token, expiresAt: exp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
