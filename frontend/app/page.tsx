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
  const [actionLabel, setActionLabel] = useState("Start"); // Start -> Next
  const [stopEnabled, setStopEnabled] = useState(false);

  // Matching state (and a ref mirror to avoid stale closures)
  const [matchingActive, setMatchingActive] = useState(false);
  const matchingRef = useRef(false);

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
    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }
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

  // Load ICE from Next API (falls back to STUN-only if it fails)
  const loadIce = async () => {
    try {
      const r = await fetch("/api/ice", { cache: "no-store" });
      if (r.ok) {
        const cfg = (await r.json()) as IceConfig;
        if (cfg && Array.isArray(cfg.iceServers)) {
          setPcConfig(cfg);
          return;
        }
      }
    } catch {}
    // keep default STUN-only config on failure
  };

  // Actions
  const startMatching = () => {
    setMatchingActive(true);
    matchingRef.current = true;

    setActionLabel("Next");
    setStopEnabled(true);
    setStatus("⏳ Looking for a partner…");
    socketRef.current?.emit("join");
  };

  const nextStranger = () => {
    teardownPeer();
    setStatus("⏳ Finding the next partner…");
    socketRef.current?.emit("next");
  };

  const stopMatching = () => {
    setMatchingActive(false);
    matchingRef.current = false;

    setActionLabel("Start");
    setStopEnabled(false);
    teardownPeer();
    socketRef.current?.emit("leave");
    setStatus("Stopped. Click Start when you’re ready.");
  };

  const onAction = () => {
    if (!matchingRef.current) startMatching();
    else nextStranger();
  };

  // Boot: media + socket wiring
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadIce();

      // Get user media immediately (preview)
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

        if (!cancelled) {
          setStatus("Ready. Click Start to connect with a stranger.");
        }
      } catch (e) {
        setStatus(
          "❌ Camera/Mic error: " + (e instanceof Error ? e.message : String(e))
        );
      }

      // Connect to signaling server (WebSocket-only)
      const url = process.env.NEXT_PUBLIC_SIGNAL_URL;
      if (!url) {
        console.error("Missing NEXT_PUBLIC_SIGNAL_URL");
      }
      const socket = io(url as string, {
        transports: ["websocket"],
        upgrade: false,
        withCredentials: true,
      });
      socketRef.current = socket;

      socket.on("connect", () => console.log("✅ socket connected", socket.id));
      socket.on("connect_error", () =>
        setStatus("⚠️ Connection issue. Retrying…")
      );

      socket.on("waiting", () => {
        if (!matchingRef.current) return;
        setStatus("⏳ Waiting for a partner…");
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
          if (!matchingRef.current) {
            socket.emit("leave");
            return;
          }
          peerIdRef.current = peerId;

          setStatus(
            "✅ Paired! " + (initiator ? "Sending offer…" : "Awaiting offer…")
          );

          buildPeer();

          if (initiator && pcRef.current) {
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);
            socket.emit("signal", {
              peerId,
              signal: { sdp: pcRef.current.localDescription },
            });
          }
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
          if (!pcRef.current) {
            if (!matchingRef.current) return;
            peerIdRef.current = peerId;
            buildPeer();
          }
          if (signal.sdp && pcRef.current) {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(signal.sdp)
            );
            if (signal.sdp.type === "offer") {
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);
              socket.emit("signal", {
                peerId: peerIdRef.current,
                signal: { sdp: pcRef.current.localDescription },
              });
            }
          } else if (signal.candidate && pcRef.current) {
            try {
              await pcRef.current.addIceCandidate(
                new RTCIceCandidate(signal.candidate)
              );
            } catch {
              /* ignore race */
            }
          }
        }
      );

      socket.on("partner-disconnected", () => {
        teardownPeer();
        if (matchingRef.current) {
          setStatus("⚠️ Stranger left. ⏳ Finding the next partner…");
          socket.emit("join");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="root">
      <h1>Random Video Chat</h1>

      <div id="status" ref={statusRef} className="status">
        Initializing…
      </div>

      {/* Inline controls for desktop/tablet */}
      <div className="controls controls-inline">
        <button onClick={onAction}>{actionLabel}</button>
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
            <button onClick={onAction}>{actionLabel}</button>
            <button onClick={stopMatching} disabled={!stopEnabled}>
              Stop
            </button>
          </div>
        </div>

        <video ref={localRef} autoPlay muted playsInline className="video" />
      </div>

      <style jsx>{`
        .root {
          font-family: system-ui, sans-serif;
          padding: 20px;
        }
        .status {
          margin: 8px 0 16px;
        }

        /* Inline controls above videos (desktop) */
        .controls-inline {
          display: none; /* hidden on mobile */
          gap: 12px;
          margin: 12px 0;
        }

        /* Overlay controls on mobile */
        .controls-overlay {
          position: absolute;
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
