"use client";

import { useRef, useState, useCallback } from "react";
import { useWebRTC } from "./hooks/useWebRTC";
import styles from "./page.module.css";

export default function Home() {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  const [status, setStatus] = useState("Initializing…");

  const handleStatusChange = useCallback((msg: string) => {
    setStatus(msg);
  }, []);

  const {
    matchingActive,
    mediaLoading,
    connectionStats,
    localAudioLevel,
    remoteAudioLevel,
    startMatching,
    nextStranger,
    stopMatching,
  } = useWebRTC({
    localVideoRef: localRef,
    remoteVideoRef: remoteRef,
    onStatusChange: handleStatusChange,
  });

  const onAction = () => {
    if (!matchingActive) {
      startMatching();
    } else {
      nextStranger();
    }
  };

  const getQualityLabel = () => {
    if (!connectionStats) return null;
    const { quality, roundTripTime } = connectionStats;
    return (
      <span className={styles.connectionQuality}>
        <span className={`${styles.qualityDot} ${styles[quality]}`} />
        {quality} ({Math.round(roundTripTime * 1000)}ms)
      </span>
    );
  };

  return (
    <main className={styles.root}>
      <h1>Random Video Chat</h1>

      <div id="status" className={styles.status}>
        {status}
        {getQualityLabel()}
      </div>

      {/* Inline controls for desktop/tablet */}
      <div className={styles.controlsInline}>
        <button onClick={onAction} disabled={mediaLoading}>
          {matchingActive ? "Next" : "Start"}
        </button>
        <button onClick={stopMatching} disabled={!matchingActive}>
          Stop
        </button>
      </div>

      {/* Videos: remote on top (mobile), side-by-side on desktop */}
      <div className={styles.videos}>
        <div className={styles.remoteWrap}>
          <video ref={remoteRef} autoPlay playsInline className={styles.video} />

          {/* Remote audio indicator */}
          {matchingActive && remoteAudioLevel > 0 && (
            <div className={styles.audioIndicator}>
              🎤
              <div className={styles.audioMeter}>
                <div
                  className={styles.audioMeterFill}
                  style={{ width: `${remoteAudioLevel}%` }}
                />
              </div>
            </div>
          )}

          {/* Overlay controls for mobile */}
          <div className={styles.controlsOverlay}>
            <button onClick={onAction} disabled={mediaLoading}>
              {matchingActive ? "Next" : "Start"}
            </button>
            <button onClick={stopMatching} disabled={!matchingActive}>
              Stop
            </button>
          </div>
        </div>

        <div className={styles.videoWrap}>
          <video ref={localRef} autoPlay muted playsInline className={styles.video} />

          {/* Local audio indicator */}
          {localAudioLevel > 0 && (
            <div className={styles.audioIndicator}>
              🎤
              <div className={styles.audioMeter}>
                <div
                  className={styles.audioMeterFill}
                  style={{ width: `${localAudioLevel}%` }}
                />
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {mediaLoading && (
            <div className={styles.loadingOverlay}>
              Loading camera...
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
