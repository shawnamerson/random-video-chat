import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { IceConfig, ConnectionStats } from "../types/webrtc";
import { isValidSignalMessage, isValidPairedMessage } from "../utils/signalValidator";

interface UseWebRTCProps {
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  onStatusChange: (status: string) => void;
}

export function useWebRTC({ localVideoRef, remoteVideoRef, onStatusChange }: UseWebRTCProps) {
  const [matchingActive, setMatchingActive] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);

  const matchingRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioContextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAudioCleanupRef = useRef<(() => void) | null>(null);
  const localAudioCleanupRef = useRef<(() => void) | null>(null);

  const [pcConfig, setPcConfig] = useState<IceConfig>({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);

  // Setup remote audio level monitoring
  const setupRemoteAudioAnalyzer = useCallback((stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      remoteAudioContextRef.current = audioContext;
      remoteAnalyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let animationId: number;
      const updateLevel = () => {
        if (!remoteAnalyserRef.current) return;
        try {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setRemoteAudioLevel(Math.min(100, (average / 255) * 100));
          animationId = requestAnimationFrame(updateLevel);
        } catch (e) {
          // Analyser might be closed, stop the loop
          return;
        }
      };
      updateLevel();

      // Return cleanup function
      return () => {
        if (animationId) {
          cancelAnimationFrame(animationId);
        }
      };
    } catch (e) {
      console.error("Error setting up remote audio analyzer:", e);
    }
  }, []);

  // Start monitoring connection stats
  const startStatsMonitoring = useCallback((pc: RTCPeerConnection) => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = setInterval(async () => {
      if (!pc) return;

      try {
        const stats = await pc.getStats();
        let bytesReceived = 0;
        let bytesSent = 0;
        let packetsLost = 0;
        let roundTripTime = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            bytesReceived = report.bytesReceived || 0;
            packetsLost = report.packetsLost || 0;
          }
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            bytesSent = report.bytesSent || 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = report.currentRoundTripTime || 0;
          }
        });

        const quality: ConnectionStats['quality'] =
          roundTripTime === 0 ? 'disconnected' :
          roundTripTime < 0.1 ? 'excellent' :
          roundTripTime < 0.3 ? 'good' : 'poor';

        setConnectionStats({
          quality,
          bytesReceived,
          bytesSent,
          packetsLost,
          roundTripTime,
        });
      } catch (e) {
        console.error("Error getting stats:", e);
      }
    }, 2000);
  }, []);

  // Properly teardown peer connection with complete cleanup
  const teardownPeer = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.close();
      } catch (e) {
        console.error("Error closing peer connection:", e);
      }
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    if (remoteAudioCleanupRef.current) {
      remoteAudioCleanupRef.current();
      remoteAudioCleanupRef.current = null;
    }
    if (remoteAudioContextRef.current) {
      try {
        remoteAudioContextRef.current.close();
      } catch {}
      remoteAudioContextRef.current = null;
      remoteAnalyserRef.current = null;
    }
    setConnectionStats(null);
    setRemoteAudioLevel(0);
    peerIdRef.current = null;
  }, [remoteVideoRef]);

  // Build peer connection with proper error handling
  const buildPeer = useCallback(() => {
    try {
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
        if (remoteVideoRef.current && stream) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play?.().catch(() => {});

          // Setup remote audio analyzer and store cleanup function
          const cleanup = setupRemoteAudioAnalyzer(stream);
          if (cleanup) {
            remoteAudioCleanupRef.current = cleanup;
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          onStatusChange("⚠️ Connection unstable...");
        } else if (pc.iceConnectionState === 'connected') {
          onStatusChange("✅ Connected!");
          startStatsMonitoring(pc);
        }
      };

      pcRef.current = pc;
    } catch (error) {
      console.error("Error building peer connection:", error);
      onStatusChange("❌ Failed to create connection");
    }
  }, [pcConfig, remoteVideoRef, onStatusChange, setupRemoteAudioAnalyzer, startStatsMonitoring]);

  // Load ICE configuration
  const loadIce = useCallback(async () => {
    try {
      const r = await fetch("/api/ice", { cache: "no-store" });
      if (r.ok) {
        const cfg = (await r.json()) as IceConfig;
        if (cfg && Array.isArray(cfg.iceServers)) {
          setPcConfig(cfg);
          return;
        }
      }
    } catch (e) {
      console.error("Failed to load ICE config:", e);
    }
  }, []);

  // Socket event handlers
  const handleWaiting = useCallback(() => {
    if (!matchingRef.current) return;
    onStatusChange("⏳ Waiting for a partner…");
  }, [onStatusChange]);

  const handlePaired = useCallback(
    async (data: unknown) => {
      if (!isValidPairedMessage(data)) {
        console.error("Invalid paired message:", data);
        return;
      }

      const { peerId, initiator } = data;

      if (!matchingRef.current) {
        socketRef.current?.emit("leave");
        return;
      }

      peerIdRef.current = peerId;
      onStatusChange(
        "✅ Paired! " + (initiator ? "Sending offer…" : "Awaiting offer…")
      );

      buildPeer();

      if (initiator && pcRef.current) {
        try {
          const offer = await pcRef.current.createOffer();
          await pcRef.current.setLocalDescription(offer);
          socketRef.current?.emit("signal", {
            peerId,
            signal: { sdp: pcRef.current.localDescription },
          });
        } catch (error) {
          console.error("Error creating offer:", error);
          onStatusChange("❌ Failed to create offer");
        }
      }
    },
    [buildPeer, onStatusChange]
  );

  const handleSignal = useCallback(
    async (data: unknown) => {
      if (!isValidSignalMessage(data)) {
        console.error("Invalid signal message:", data);
        return;
      }

      const { peerId, signal } = data;

      if (!pcRef.current) {
        if (!matchingRef.current) return;
        peerIdRef.current = peerId;
        buildPeer();
      }

      const pc = pcRef.current;
      if (!pc) return;

      try {
        if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          if (signal.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socketRef.current?.emit("signal", {
              peerId: peerIdRef.current,
              signal: { sdp: pc.localDescription },
            });
          }
        } else if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (error) {
        console.error("Error handling signal:", error);
      }
    },
    [buildPeer]
  );

  const handlePartnerDisconnected = useCallback(() => {
    teardownPeer();
    if (matchingRef.current) {
      onStatusChange("⚠️ Stranger left. ⏳ Finding the next partner…");
      socketRef.current?.emit("join");
    } else {
      onStatusChange("⚠️ Stranger left.");
    }
  }, [teardownPeer, onStatusChange]);

  const handleSocketConnect = useCallback(() => {
    console.log("✅ socket connected", socketRef.current?.id);

    // Rejoin if we were matching before disconnect
    if (matchingRef.current) {
      onStatusChange("🔄 Reconnected! Looking for partner…");
      socketRef.current?.emit("join");
    }
  }, [onStatusChange]);

  const handleSocketDisconnect = useCallback(() => {
    console.warn("⚠️ Socket disconnected");
    teardownPeer();
    if (matchingRef.current) {
      onStatusChange("⚠️ Connection lost. Reconnecting…");
    }
  }, [teardownPeer, onStatusChange]);

  // Get user media with specific camera
  const getUserMediaWithCamera = useCallback(async (deviceId?: string) => {
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: true,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Enumerate cameras after getting permission
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === 'videoinput');
    setAvailableCameras(cameras);

    return stream;
  }, []);

  // Switch camera
  const switchCamera = useCallback(async () => {
    if (availableCameras.length <= 1) return;

    try {
      // Stop current stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Stop local audio analyzer
      if (localAudioCleanupRef.current) {
        localAudioCleanupRef.current();
      }
      if (localAudioContextRef.current) {
        try {
          localAudioContextRef.current.close();
        } catch {}
      }

      // Get next camera
      const nextIndex = (currentCameraIndex + 1) % availableCameras.length;
      setCurrentCameraIndex(nextIndex);
      const nextCamera = availableCameras[nextIndex];

      // Get new stream with selected camera
      const stream = await getUserMediaWithCamera(nextCamera.deviceId);
      streamRef.current = stream;

      // Update local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => {});
      }

      // Setup local audio analyzer
      try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        localAudioContextRef.current = audioContext;
        localAnalyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let animationId: number;
        const updateLevel = () => {
          if (!localAnalyserRef.current) return;
          try {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setLocalAudioLevel(Math.min(100, (average / 255) * 100));
            animationId = requestAnimationFrame(updateLevel);
          } catch {
            return;
          }
        };
        updateLevel();

        localAudioCleanupRef.current = () => {
          if (animationId) cancelAnimationFrame(animationId);
        };
      } catch (e) {
        console.error("Error setting up audio analyzer:", e);
      }

      // Update peer connection if we're in a call
      if (pcRef.current && matchingRef.current) {
        const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
        const newVideoTrack = stream.getVideoTracks()[0];
        if (videoSender && newVideoTrack) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }
    } catch (e) {
      console.error("Error switching camera:", e);
      onStatusChange("❌ Failed to switch camera");
    }
  }, [availableCameras, currentCameraIndex, getUserMediaWithCamera, localVideoRef, onStatusChange]);

  // Actions
  const startMatching = useCallback(() => {
    // Persist state
    try {
      localStorage.setItem('matchingActive', 'true');
    } catch {}

    setMatchingActive(true);
    matchingRef.current = true;
    onStatusChange("⏳ Looking for a partner…");
    socketRef.current?.emit("join");
  }, [onStatusChange]);

  const nextStranger = useCallback(() => {
    teardownPeer();
    onStatusChange("⏳ Finding the next partner…");
    socketRef.current?.emit("next");
  }, [teardownPeer, onStatusChange]);

  const stopMatching = useCallback(() => {
    // Clear persisted state
    try {
      localStorage.removeItem('matchingActive');
    } catch {}

    setMatchingActive(false);
    matchingRef.current = false;
    teardownPeer();
    socketRef.current?.emit("leave");
    onStatusChange("Stopped. Click Start when you're ready.");
  }, [teardownPeer, onStatusChange]);

  // Initialize media and socket
  useEffect(() => {
    let cancelled = false;

    // Clear any stale localStorage matching state from previous sessions
    try {
      localStorage.removeItem('matchingActive');
    } catch {}

    (async () => {
      await loadIce();

      // Get user media
      try {
        const stream = await getUserMediaWithCamera();
        streamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true;
          localVideoRef.current.playsInline = true;
          await localVideoRef.current.play().catch(() => {});
        }

        if (!cancelled) {
          setMediaLoading(false);

          // Setup local audio analyzer
          try {
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            localAudioContextRef.current = audioContext;
            localAnalyserRef.current = analyser;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let animationId: number;
            const updateLevel = () => {
              if (!localAnalyserRef.current) return;
              try {
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                setLocalAudioLevel(Math.min(100, (average / 255) * 100));
                animationId = requestAnimationFrame(updateLevel);
              } catch (e) {
                // Analyser might be closed, stop the loop
                return;
              }
            };
            updateLevel();

            // Store cleanup function
            localAudioCleanupRef.current = () => {
              if (animationId) {
                cancelAnimationFrame(animationId);
              }
            };
          } catch (e) {
            console.error("Error setting up local audio analyzer:", e);
          }

          onStatusChange("Ready. Click Start to connect with a stranger.");
        }
      } catch (e) {
        setMediaLoading(false);
        onStatusChange(
          "❌ Camera/Mic error: " + (e instanceof Error ? e.message : String(e))
        );
        return;
      }

      // Connect to signaling server
      const url = process.env.NEXT_PUBLIC_SIGNAL_URL;
      if (!url) {
        console.error("Missing NEXT_PUBLIC_SIGNAL_URL");
        onStatusChange("❌ Configuration error: Missing server URL");
        return;
      }

      const socket = io(url, {
        transports: ["websocket"],
        upgrade: false,
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
      });
      socketRef.current = socket;

      socket.on("connect", handleSocketConnect);
      socket.on("disconnect", handleSocketDisconnect);
      socket.on("connect_error", () => {
        onStatusChange("⚠️ Connection issue. Retrying…");
      });
      socket.on("waiting", handleWaiting);
      socket.on("paired", handlePaired);
      socket.on("signal", handleSignal);
      socket.on("partner-disconnected", handlePartnerDisconnected);
    })();

    return () => {
      cancelled = true;
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
      if (localAudioCleanupRef.current) {
        localAudioCleanupRef.current();
      }
      if (localAudioContextRef.current) {
        try {
          localAudioContextRef.current.close();
        } catch {}
      }
      if (remoteAudioCleanupRef.current) {
        remoteAudioCleanupRef.current();
      }
      if (remoteAudioContextRef.current) {
        try {
          remoteAudioContextRef.current.close();
        } catch {}
      }
      try {
        streamRef.current?.getTracks().forEach(track => track.stop());
      } catch {}
      try {
        socketRef.current?.close();
      } catch {}
      try {
        pcRef.current?.close();
      } catch {}
    };
    // This effect should only run once on mount
    // All callbacks are wrapped in useCallback with proper dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    matchingActive,
    mediaLoading,
    connectionStats,
    localAudioLevel,
    remoteAudioLevel,
    availableCameras,
    startMatching,
    nextStranger,
    stopMatching,
    switchCamera,
  };
}
