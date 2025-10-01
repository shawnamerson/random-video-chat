import { SignalMessage, PairedMessage } from '../types/webrtc';

export function isValidSignalMessage(data: unknown): data is SignalMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;

  if (typeof msg.peerId !== 'string' || !msg.peerId) return false;
  if (typeof msg.signal !== 'object' || msg.signal === null) return false;

  const signal = msg.signal as Record<string, unknown>;

  // Must have either sdp or candidate, not both or neither
  if (signal.sdp && signal.candidate) return false;
  if (!signal.sdp && !signal.candidate) return false;

  if (signal.sdp) {
    const sdp = signal.sdp as Record<string, unknown>;
    if (typeof sdp.type !== 'string' || !['offer', 'answer'].includes(sdp.type)) return false;
    if (typeof sdp.sdp !== 'string') return false;
  }

  if (signal.candidate) {
    const candidate = signal.candidate as Record<string, unknown>;
    if (typeof candidate.candidate !== 'string') return false;
  }

  return true;
}

export function isValidPairedMessage(data: unknown): data is PairedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;

  return typeof msg.peerId === 'string' && msg.peerId !== '' && typeof msg.initiator === 'boolean';
}
