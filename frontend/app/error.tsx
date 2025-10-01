'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    }}>
      <h2 style={{ marginBottom: '1rem' }}>⚠️ Something went wrong</h2>

      {!process.env.NEXT_PUBLIC_SIGNAL_URL && (
        <div style={{
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          maxWidth: '600px',
        }}>
          <h3 style={{ marginTop: 0 }}>Configuration Error</h3>
          <p>The environment variable <code>NEXT_PUBLIC_SIGNAL_URL</code> is not set.</p>
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            Please configure this in your Vercel project settings under Environment Variables.
          </p>
        </div>
      )}

      <details style={{ marginBottom: '20px', maxWidth: '600px', textAlign: 'left' }}>
        <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>Error details</summary>
        <pre style={{
          background: '#f5f5f5',
          padding: '10px',
          borderRadius: '4px',
          overflow: 'auto',
          fontSize: '0.85em',
        }}>
          {error.message}
        </pre>
      </details>

      <button
        onClick={reset}
        style={{
          padding: '10px 20px',
          background: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '16px',
        }}
      >
        Try again
      </button>
    </div>
  );
}
