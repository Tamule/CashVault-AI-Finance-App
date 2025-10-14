
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import arcjet, { tokenBucket, shield, detectBot } from "@arcjet/next";


const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/account(.*)",
  "/transaction(.*)",
]);

export const clerkProtect = clerkMiddleware(async (auth, req) => {
  const { userId, redirectToSignIn } = await auth();

  if (!userId && isProtectedRoute(req)) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  return NextResponse.next();
});


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

export async function rateLimitAPIRoute(req, userId) {
  const decision = await ajRateLimit.protect(req, {
    userId: userId || "anonymous",
  });

  if (decision.isDenied()) {
    return {
      allowed: false,
      response: Response.json(
        {
          error: "Too Many Requests",
          reason: "Rate limit exceeded. Please try again later.",
          resetTime: decision.resetTime,
        },
        { status: 429 }
      ),
    };
  }

  return { allowed: true, remaining: decision.remaining };
}

export async function protectWithRateLimit(req, userId) {
  const protection = await protectAPIRoute(req);
  if (!protection.allowed) return protection;

  return await rateLimitAPIRoute(req, userId);
}


import { inngest } from "@/lib/inngest/client";
import {
  checkBudgetAlerts,
  triggerRecurringTransactions,
  processRecurringTransaction,
  generateMonthlyReports,
} from "@/lib/inngest/functions";
import { serve } from "inngest/next";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    checkBudgetAlerts,
    triggerRecurringTransactions,
    processRecurringTransaction,
    generateMonthlyReports,
  ],
});


export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
