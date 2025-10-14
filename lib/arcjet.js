import arcjet, { tokenBucket, shield, detectBot } from "@arcjet/next";

// Rate limiting instance 
export const ajRateLimit = arcjet({
  key: process.env.ARCJET_KEY,
  characteristics: ["userId"],
  rules: [
    tokenBucket({
      mode: "LIVE",
      refillRate: 2,
      interval: 3600,
      capacity: 2,
    }),
  ],
});

// General protection instance 
export const ajProtection = arcjet({
  key: process.env.ARCJET_KEY,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE", "GO_HTTP"],
    }),
  ],
});

// Helper to protect API routes with full protection
export async function protectAPIRoute(req) {
  const decision = await ajProtection.protect(req);
  
  if (decision.isDenied()) {
    return {
      allowed: false,
      response: Response.json(
        { error: "Forbidden", reason: decision.reason },
        { status: 403 }
      ),
    };
  }
  
  return { allowed: true };
}

// Helper to apply rate limiting
export async function rateLimitAPIRoute(req, userId) {
  const decision = await ajRateLimit.protect(req, { 
    userId: userId || "anonymous" 
  });
  
  if (decision.isDenied()) {
    return {
      allowed: false,
      response: Response.json(
        { 
          error: "Too Many Requests", 
          reason: "Rate limit exceeded. Please try again later.",
          resetTime: decision.resetTime 
        },
        { status: 429 }
      ),
    };
  }
  
  return { allowed: true, remaining: decision.remaining };
}

// Combined protection (shield + bot + rate limit)
export async function protectWithRateLimit(req, userId) {
  // check general protection
  const protection = await protectAPIRoute(req);
  if (!protection.allowed) {
    return protection;
  }
  
  //  check rate limit
  return await rateLimitAPIRoute(req, userId);
}