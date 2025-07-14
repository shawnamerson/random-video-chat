"use client";

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import type { Socket as SocketType } from "socket.io-client";

export default function HomePage() {
  const localVidRef = useRef<HTMLVideoElement>(null);
  const remoteVidRef = useRef<HTMLVideoElement>(null);

  // UI / control state
  const [status, setStatus] = useState("Stopped");
  const [isRunning, setIsRunning] = useState(false);
  const [canNext, setCanNext] = useState(false);

  // RTC & signaling
  const [socket, setSocket] = useState<typeof SocketType>();
  const [peerId, setPeerId] = useState<string>();
  const [initiator, setInitiator] = useState(false);
  const [pc, setPc] = useState<RTCPeerConnection | undefined>();

  // Tear down current call
  const disconnect = () => {
    if (pc) {
      pc.close();
      setPc(undefined);
    }
    if (remoteVidRef.current) {
      remoteVidRef.current.srcObject = null;
    }
    socket?.emit("leave");
    setCanNext(false);
  };

  // Connect (or reconnect) to a stranger
  const reconnect = () => {
    disconnect();
    setStatus("⏳ Looking for a new partner…");
    socket?.emit("join");
  };

  // Start or stop auto-connecting
  const toggleRun = () => {
    if (isRunning) {
      // Stop
      setIsRunning(false);
      disconnect();
      setStatus("Stopped");
    } else {
      // Start
      setIsRunning(true);
      setStatus("Initializing…");
      reconnect();
    }
  };

  // One-time setup: socket + getUserMedia
  useEffect(() => {
    // Use a relative endpoint so in production it connects to
    // wss://<your-domain>/socket.io, and in dev Next.js rewrites to localhost:4000
    const s: typeof SocketType = io({
      transports: ["websocket"],
      path: "/socket.io",
    });
    setSocket(s);

    s.on("connect", () => console.log("🟢 connected as", s.id));
    s.on("connect_error", (err) => console.error("❌ conn error", err));

    // grab camera/mic once
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (localVidRef.current) {
          localVidRef.current.srcObject = stream;
        }
      })
      .catch((err) => setStatus("⚠️ Camera/Mic error: " + err.message));

    return () => {
      s.disconnect();
    };
  }, []);

  // Signaling & WebRTC handlers
  useEffect(() => {
    if (!socket) return;
    const pcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

    socket.on("waiting", () => {
      setStatus("⏳ Waiting for a partner…");
      setCanNext(false);
    });

    socket.on("paired", async ({ peerId, initiator }) => {
      setPeerId(peerId);
      setInitiator(initiator);
      setStatus(
        "✅ Paired! " + (initiator ? "Sending offer…" : "Awaiting offer…")
      );
      setCanNext(true);

      const connection = new RTCPeerConnection(pcConfig);
      setPc(connection);

      // add local tracks
      const localStream = localVidRef.current!.srcObject as MediaStream;
      localStream
        .getTracks()
        .forEach((track) => connection.addTrack(track, localStream));

      connection.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("signal", { peerId, signal: { candidate } });
      };
      connection.ontrack = ({ streams: [stream] }) => {
        if (remoteVidRef.current) {
          remoteVidRef.current.srcObject = stream;
        }
      };

      if (initiator) {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit("signal", {
          peerId,
          signal: { sdp: connection.localDescription! },
        });
      }
    });

    socket.on("signal", async ({ signal }) => {
      if (!pc) return;
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", {
            peerId,
            signal: { sdp: pc.localDescription! },
          });
        }
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    });

    socket.on("partner-disconnected", () => {
      setStatus(
        isRunning ? "⚠️ Stranger left. Reconnecting…" : "⚠️ Stranger left."
      );
      if (isRunning) reconnect();
      else disconnect();
    });

    return () => {
      socket.off("waiting");
      socket.off("paired");
      socket.off("signal");
      socket.off("partner-disconnected");
    };
  }, [socket, pc, peerId, initiator, isRunning]);

  return (
    <main style={{ textAlign: "center", padding: "1rem" }}>
      <h1>Random Video Chat</h1>
      <p>
        <strong>{status}</strong>
      </p>

      <button
        onClick={toggleRun}
        style={{ margin: "0.5rem", padding: "0.5rem 1rem" }}
      >
        {isRunning ? "Stop" : "Start"}
      </button>

      <button
        onClick={reconnect}
        disabled={!canNext}
        style={{ margin: "0.5rem", padding: "0.5rem 1rem" }}
      >
        Next
      </button>

      <div>
        <video
          ref={localVidRef}
          autoPlay
          muted
          playsInline
          style={{ width: "45%", margin: "0 2%", background: "#000" }}
        />
        <video
          ref={remoteVidRef}
          autoPlay
          playsInline
          style={{ width: "45%", margin: "0 2%", background: "#000" }}
        />
      </div>
    </main>
  );
}
