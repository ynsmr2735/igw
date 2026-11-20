export const dynamic = "force-dynamic";

/**
 * Removed: the old demo endpoint (top up / withdraw / exchange) could create
 * balance out of nothing. Kept as a stub so an older copy of this file left in
 * the repository cannot break the build. Use /api/deposits and /api/transfers.
 */
export async function POST() {
  return Response.json({ error: "This endpoint was removed. Use /api/deposits or /api/transfers." }, { status: 410 });
}
