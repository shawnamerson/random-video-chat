export type IceConfig = RTCConfiguration;

export interface SignalMessage {
  peerId: string;
  signal: {
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
}

export interface PairedMessage {
  peerId: string;
  initiator: boolean;
}

export interface ConnectionStats {
  quality: 'excellent' | 'good' | 'poor' | 'disconnected';
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  roundTripTime: number;
}
