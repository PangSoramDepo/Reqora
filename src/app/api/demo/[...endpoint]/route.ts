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

  // A tiny maker-checker bank: log in for a token, a maker creates a transfer, someone else approves it.
  "bank/login": (body) => {
    if (!body.login_id || !body.password) return problem(401, "Unauthorized", { detail: "login_id and password are required" });
    const token = `tok_${String(body.login_id).replace(/\W/g, "")}_${crypto.randomUUID().slice(0, 8)}`;
    bank.tokens.set(token, String(body.login_id));
    return Response.json({ access_token: token, token_type: "Bearer", expires_in: 1800 });
  },
  "bank/transfers": (body, request) => {
    const user = bankUser(request);
    if (!user) return problem(401, "Unauthorized", { detail: "invalid or expired access token" });
    const id = `trf_${crypto.randomUUID().slice(0, 8)}`;
    bank.transfers.set(id, { maker: user, amount: Number(body.amount ?? 0), status: "PENDING_APPROVAL" });
    return Response.json({ transfer_id: id, status: "PENDING_APPROVAL", maker: user }, { status: 201 });
  },
  "bank/transfers/approve": (body, request) => {
    const user = bankUser(request);
    if (!user) return problem(401, "Unauthorized", { detail: "invalid or expired access token" });
    const transfer = bank.transfers.get(String(body.transfer_id));
    if (!transfer) return problem(404, "Not Found", { detail: `no transfer "${String(body.transfer_id)}"` });
    if (transfer.maker === user) return problem(403, "Forbidden", { detail: "a maker can't approve their own transfer" });
    transfer.status = "APPROVED";
    return Response.json({ transfer_id: body.transfer_id, status: "APPROVED", maker: transfer.maker, approved_by: user });
  },
};

// The demo bank's tokens and transfers live in memory (kept across dev reloads).
const bank: { tokens: Map<string, string>; transfers: Map<string, { maker: string; amount: number; status: string }> } = ((
  globalThis as { __reqoraDemoBank?: typeof bank }
).__reqoraDemoBank ??= { tokens: new Map(), transfers: new Map() });

const bankUser = (request: Request) => {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? bank.tokens.get(auth.slice(7)) : undefined;
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
