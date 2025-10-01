# Deployment Guide

## Environment Variables

### Required Variables

You must set the following environment variable in your Vercel project:

```bash
NEXT_PUBLIC_SIGNAL_URL=wss://your-backend-server.com
```

**Where to set this on Vercel:**
1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add `NEXT_PUBLIC_SIGNAL_URL` with your backend WebSocket URL
4. Example values:
   - Production: `wss://your-backend.ondigitalocean.app`
   - Development: `ws://localhost:3001`

### Optional Variables

```bash
# Custom ICE endpoint (if different from SIGNAL_URL/ice)
ICE_URL=https://your-backend.com/ice
```

## Backend Setup

Your backend must be running and accessible from the frontend domain. Make sure:

1. **Backend is deployed** (e.g., DigitalOcean, Railway, Render)
2. **Backend CORS allows your Vercel URL**:
   ```javascript
   // In backend server.js, ALLOWED_ORIGINS should include:
   "https://your-app.vercel.app"
   ```
3. **WebSocket support is enabled** on your hosting platform

## Troubleshooting

### "Application error: a client-side exception has occurred"

This usually means `NEXT_PUBLIC_SIGNAL_URL` is missing or incorrect.

**Fix:**
1. Add the environment variable in Vercel
2. **Redeploy** (environment variables require a redeploy to take effect)

### Camera permission errors

Make sure your site is served over HTTPS. Vercel provides this automatically for production deployments.

### Connection issues

1. Check browser console for specific errors
2. Verify backend is running: Visit `https://your-backend.com/healthz`
3. Check backend logs for CORS errors
4. Ensure WebSocket (wss://) is used for HTTPS sites

## Local Development

Create a `.env.local` file in the frontend directory:

```bash
NEXT_PUBLIC_SIGNAL_URL=ws://localhost:3001
```

Make sure your backend is running locally on port 3001.
