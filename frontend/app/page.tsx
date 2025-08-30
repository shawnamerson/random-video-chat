"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type IceConfig = RTCConfiguration;

export default function Home() {
  // UI refs
  const statusRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  // UI state
  const [actionLabel, setActionLabel] = useState<"Start" | "Next">("Start");
  const [stopEnabled, setStopEnabled] = useState(false);
  const [actionDisabled, setActionDisabled] = useState(false);

  // Matching state
  const [matchingActive, setMatchingActive] = useState(false);
  const matchingRef = useRef(false);

  // Connection sequencing (prevents stale events during Next)
  const sessionRef = useRef(0); // increments on Start/Next/Stop
  const nextInFlightRef = useRef(false);

  // ICE / WebRTC
  const [pcConfig, setPcConfig] = useState<IceConfig>({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string | null>(null);

  // Socket
  const socketRef = useRef<Socket | null>(null);

  // Helpers
  const setStatus = (msg: string) => {
    if (statusRef.current) statusRef.current.textContent = msg;
  };

  const teardownPeer = () => {
    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    if (remoteRef.current) remoteRef.current.srcObject = null;
    peerIdRef.current = null;
  };

  const buildPeer = () => {
    const pc = new RTCPeerConnection(pcConfig);
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current && peerIdRef.current) {
        socketRef.current.emit("signal", {
          peerId: peerIdRef.current,
          signal: { candidate },
        });
      }
    };
    pc.ontrack = ({ streams: [stream] }) => {
      if (remoteRef.current) {
        remoteRef.current.srcObject = stream;
        remoteRef.current.play?.().catch(() => {});
      }
    };
    pcRef.current = pc;
  };

  const loadIce = async () => {
    try {
      const r = await fetch("/api/ice", { cache: "no-store" });
      if (r.ok) {
        const cfg = (await r.json()) as IceConfig;
        if (cfg && Array.isArray(cfg.iceServers)) setPcConfig(cfg);
      }
    } catch {}
  };

  // Actions
  const startMatching = () => {
    sessionRef.current += 1;
    setMatchingActive(true);
    matchingRef.current = true;

    setActionLabel("Next");
    setStopEnabled(true);
    setActionDisabled(true);
    setStatus("⏳ Looking for a partner…");
    socketRef.current?.emit("join");
  };

  // Prefer server "next" with ack; fallback to leave→join if unsupported.
  const nextStranger = () => {
    if (nextInFlightRef.current) return;
    nextInFlightRef.current = true;
    setActionDisabled(true);

    // bump session so any late events from the old pairing are ignored
    const mySession = ++sessionRef.current;

    // local cleanup first (prevents ICE leaks & stale ontrack firing)
    teardownPeer();
    setStatus("⏳ Finding the next partner…");

    let acked = false;
    let ackTimer: number | undefined;

    try {
      socketRef.current
        ?.timeout(300)
        .emit("next", (err: unknown, ok?: boolean) => {
          if (mySession !== sessionRef.current) return;
          acked = true;
          if (ackTimer) clearTimeout(ackTimer);
          // If server handled "next", nothing else to do; we’ll get "waiting" or "paired".
          nextInFlightRef.current = false;
        });
    } catch {
      // ignore; we’ll fall back
    }

    // Fallback if server doesn't implement "next"
    // small delay lets server process any in-flight pair teardown
    ackTimer = window.setTimeout(() => {
      if (mySession !== sessionRef.current) return;
      if (acked) return;
      socketRef.current?.emit("leave");
      setTimeout(() => {
        if (mySession !== sessionRef.current || !matchingRef.current) return;
        socketRef.current?.emit("join");
        nextInFlightRef.current = false;
      }, 120);
    }, 180) as unknown as number;
  };

  const stopMatching = () => {
    sessionRef.current += 1;
    setMatchingActive(false);
    matchingRef.current = false;
    nextInFlightRef.current = false;

    setActionLabel("Start");
    setStopEnabled(false);
    setActionDisabled(false);
    teardownPeer();
    socketRef.current?.emit("leave");
    setStatus("Stopped. Click Start when you’re ready.");
  };

  const onAction = () => {
    if (actionDisabled) return;
    if (!matchingRef.current) startMatching();
    else nextStranger();
  };

  // Boot: media + socket wiring
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadIce();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        streamRef.current = stream;
        if (localRef.current) {
          localRef.current.srcObject = stream;
          localRef.current.muted = true;
          localRef.current.playsInline = true;
          await localRef.current.play().catch(() => {});
        }
        if (!cancelled)
          setStatus("Ready. Click Start to connect with a stranger.");
      } catch (e) {
        setStatus(
          "❌ Camera/Mic error: " + (e instanceof Error ? e.message : String(e))
        );
      }

      const url = process.env.NEXT_PUBLIC_SIGNAL_URL;
      if (!url) console.error("Missing NEXT_PUBLIC_SIGNAL_URL");
      const socket = io(url as string, {
        transports: ["websocket"],
        upgrade: false,
        withCredentials: true,
      });
      socketRef.current = socket;

      socket.on("connect_error", () =>
        setStatus("⚠️ Connection issue. Retrying…")
      );

      socket.on("waiting", () => {
        if (!matchingRef.current) return;
        setStatus("⏳ Waiting for a partner…");
        setActionDisabled(false);
      });

      socket.on(
        "paired",
        async ({
          peerId,
          initiator,
        }: {
          peerId: string;
          initiator: boolean;
        }) => {
          // Ignore stale pair events from a previous session (e.g., during Next)
          if (!matchingRef.current) {
            socket.emit("leave");
            return;
          }

          // If we somehow get paired while a peer exists (race), reset cleanly
          if (
            pcRef.current &&
            peerIdRef.current &&
            peerIdRef.current !== peerId
          ) {
            teardownPeer();
          }

          peerIdRef.current = peerId;
          setStatus(
            "✅ Paired! " + (initiator ? "Sending offer…" : "Awaiting offer…")
          );

          buildPeer();

          if (initiator && pcRef.current) {
            try {
              const offer = await pcRef.current.createOffer();
              await pcRef.current.setLocalDescription(offer);
              socket.emit("signal", {
                peerId,
                signal: { sdp: pcRef.current.localDescription },
              });
            } catch {}
          }

          setActionDisabled(false);
        }
      );

      socket.on(
        "signal",
        async ({
          peerId,
          signal,
        }: {
          peerId: string;
          signal: {
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
          };
        }) => {
          // Drop signals that arrive after we’ve moved to a new session
          if (!matchingRef.current) return;

          if (!pcRef.current) {
            // Late-first signal: build peer lazily
            peerIdRef.current = peerId;
            buildPeer();
          }

          if (!pcRef.current) return;

          if (signal.sdp) {
            try {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription(signal.sdp)
              );
              if (signal.sdp.type === "offer") {
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                socketRef.current?.emit("signal", {
                  peerId: peerIdRef.current,
                  signal: { sdp: pcRef.current.localDescription },
                });
              }
            } catch {
              // If we hit an SDP error mid-swap, reset and requeue
              teardownPeer();
              if (matchingRef.current) socketRef.current?.emit("join");
            }
          } else if (signal.candidate) {
            try {
              await pcRef.current.addIceCandidate(
                new RTCIceCandidate(signal.candidate)
              );
            } catch {
              // ignore ICE races
            }
          }
        }
      );

      socket.on("partner-disconnected", () => {
        teardownPeer();
        if (matchingRef.current) {
          setStatus("⚠️ Stranger left. ⏳ Finding the next partner…");
          // requeue safely
          socket.emit("leave");
          setTimeout(() => matchingRef.current && socket.emit("join"), 120);
        } else {
          setStatus("⚠️ Stranger left.");
        }
      });
    })();

    return () => {
      cancelled = true;
      try {
        socketRef.current?.close();
      } catch {}
      try {
        pcRef.current?.close();
      } catch {}
    };
  }, []);

  return (
    <main className="root">
      <h1>Random Video Chat</h1>

      <div id="status" ref={statusRef} className="status">
        Initializing…
      </div>

      {/* Inline controls for desktop/tablet */}
      <div className="controls controls-inline">
        <button onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </button>
        <button onClick={stopMatching} disabled={!stopEnabled}>
          Stop
        </button>
      </div>

      {/* Videos: remote on top (mobile), side-by-side on desktop */}
      <div className="videos">
        <div className="remoteWrap">
          <video ref={remoteRef} autoPlay playsInline className="video" />
          {/* Overlay controls for mobile */}
          <div className="controls controls-overlay">
            <button onClick={onAction} disabled={actionDisabled}>
              {actionLabel}
            </button>
            <button onClick={stopMatching} disabled={!stopEnabled}>
              Stop
            </button>
          </div>
        </div>

        <video ref={localRef} autoPlay muted playsInline className="video" />
      </div>

      <style jsx>{`
        .root {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica,
            Arial, sans-serif;
          padding: 20px;
        }
        .status {
          margin: 8px 0 16px;
        }

        /* Layout: vertical stack by default (mobile) */
        .videos {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          align-items: start;
        }
        .video {
          width: 100%;
          max-width: 720px;
          background: #000;
          border-radius: 12px;
        }
        .remoteWrap {
          position: relative;
          width: 100%;
          max-width: 720px;
        }

        /* Controls */
        .controls-inline {
          display: none; /* hidden on mobile */
          gap: 12px;
          margin: 12px 0;
        }
        .controls-overlay {
          position: absolute; /* overlay on remote video (mobile) */
          inset: auto 0 12px 0;
          display: flex;
          justify-content: center;
          gap: 12px;
          padding: 8px 0;
        }
        .controls-overlay button {
          background: rgba(255, 255, 255, 0.92);
          border: 0;
          border-radius: 999px;
          padding: 10px 16px;
        }

        /* Desktop/tablet: side-by-side videos, inline controls */
        @media (min-width: 768px) {
          .videos {
            grid-template-columns: 1fr 1fr;
          }
          .controls-inline {
            display: flex;
          }
          .controls-overlay {
            display: none; /* hide overlay on larger screens */
          }
        }

        button {
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
