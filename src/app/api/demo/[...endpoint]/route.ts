import { problem } from "@/lib/http";

// Stand-ins for Stripe, the ERP and Slack so the seeded checkout workflow runs without real credentials.

type Body = Record<string, unknown>;

const HANDLERS: Record<string, (body: Body, request: Request) => Response> = {
  "stripe/customers/verify": (body, request) => {
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
      return problem(401, "Unauthorized", { detail: "missing bearer token" });
    }
    return Response.json({
      status: "verified",
      customer_id: `cus_${String(body.account_token ?? "anon").replace(/\W/g, "").slice(-8)}`,
      risk_score: 12,
      tier_eligible: Number(body.expected_amount) > 500,
    });
  },
  "erp/sync-inventory": (body) => {
    if (!body.sku) return problem(422, "Unprocessable Content", { detail: "sku is required" });
    return Response.json({ ack: true, reservation_id: `rsv_${Date.now().toString(36)}`, sku: body.sku, qty: body.qty });
  },
  "slack/messages": (body) => Response.json({ ok: true, channel: body.channel, ts: (Date.now() / 1000).toFixed(6) }),
};

export async function POST(request: Request, ctx: RouteContext<"/api/demo/[...endpoint]">) {
  const { endpoint } = await ctx.params;
  const handler = HANDLERS[endpoint.join("/")];
  if (!handler) return problem(404, "Not Found", { detail: `no demo endpoint "${endpoint.join("/")}"` });

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Handlers validate what they need.
  }
  return handler(body, request);
}
