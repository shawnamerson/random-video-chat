export async function GET() {
  // Prefer explicit ICE_URL; otherwise derive from SIGNAL_URL.
  const url =
    process.env.ICE_URL ||
    `${process.env.NEXT_PUBLIC_SIGNAL_URL?.replace(/\/$/, "")}/ice`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      return Response.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }, { status: 200 });
    }
    const data = await r.json();
    return Response.json(data, { status: 200 });
  } catch (e) {
    return Response.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }, { status: 200 });
  }
}
