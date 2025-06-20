import crypto from 'crypto';

// In-memory state storage (resets on deployment)
const pendingStates = new Map();

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;
  
  console.log('Request:', req.method, pathname);
  
  // Route: Home page
  if (pathname === '/' || pathname === '/api' || pathname === '/api/') {
    return handleHomePage(res);
  }
  
  // Route: Start OAuth
  if (pathname === '/auth/start' || pathname === '/api/auth/start') {
    return handleAuthStart(req, res, url.searchParams);
  }
  
  // Route: OAuth callback
  if (pathname === '/auth/callback' || pathname === '/api/auth/callback') {
    return handleAuthCallback(req, res, url.searchParams);
  }
  
  // Route: Health check
  if (pathname === '/health' || pathname === '/api/health') {
    return res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      environment: 'vercel'
    });
  }
  
  // 404 for unknown routes
  return res.status(404).json({ error: 'Not found', path: pathname });
}

function handleHomePage(res) {
  const html = `<!DOCTYPE html>
<html>
<head>
    <title>Slack User Token Generator</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
        .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .button { background: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 15px 0; border: none; cursor: pointer; font-size: 16px; }
        .button:hover { background: #45a049; }
        .form-group { margin: 15px 0; }
        label { display: block; margin-bottom: 8px; font-weight: 600; }
        input { width: 100%; max-width: 400px; padding: 12px; border: 2px solid #ddd; border-radius: 8px; }
        .warning { background: #fff3cd; color: #856404; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .info { background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Slack User Token Generator</h1>
        
        <div class="warning">
            <strong>⚠️ Important:</strong> This will generate a personal access token for your Slack account.
        </div>
        
        <div class="info">
            <strong>✅ This app will request permissions to:</strong>
            <ul>
                <li>View basic information about public channels</li>
                <li>View basic information about your private channels</li>
                <li>View people in the workspace</li>
            </ul>
        </div>
        
        <form action="/auth/start" method="get">
            <div class="form-group">
                <label for="user_id">Your User ID (optional):</label>
                <input type="text" id="user_id" name="user_id" placeholder="john.doe" maxlength="100">
            </div>
            
            <div class="form-group">
                <label for="user_name">Your Name (optional):</label>
                <input type="text" id="user_name" name="user_name" placeholder="John Doe" maxlength="100">
            </div>
            
            <button type="submit" class="button">🚀 Generate My Slack Token</button>
        </form>
        
        <p><a href="/health">Health Check</a> | <a href="/api/test">API Test</a></p>
    </div>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

function handleAuthStart(req, res, searchParams) {
  const state = crypto.randomBytes(16).toString('hex');
  const userId = searchParams.get('user_id') || '';
  const userName = searchParams.get('user_name') || '';
  
  // Store state temporarily
  pendingStates.set(state, {
    user_id: userId,
    user_name: userName,
    timestamp: Date.now()
  });
  
  const userScopes = const userScopes = [
    'channels:history',
    'channels:read', 
    'channels:write',
    'chat:write',        // ← This is the key missing scope!
    'groups:read',
    'groups:write', 
    'im:history',
    'im:write',
    'mpim:history',
    'users:read',
    'search:read'
  ].join(',');
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return res.status(500).send('<h1>Server Configuration Error</h1><p>Missing Slack credentials</p>');
  }
  
  const authUrl = `https://slack.com/oauth/v2/authorize?` +
    `client_id=${clientId}&` +
    `user_scope=${encodeURIComponent(userScopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${state}`;
  
  return res.redirect(authUrl);
}

async function handleAuthCallback(req, res, searchParams) {
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  
  if (error) {
    return res.status(400).send(`<h1>❌ OAuth Error</h1><p>${error}</p><a href="/">Try Again</a>`);
  }
  
  if (!code || !state) {
    return res.status(400).send(`<h1>❌ Missing Parameters</h1><p>Missing code or state</p><a href="/">Try Again</a>`);
  }
  
  const stateData = pendingStates.get(state);
  if (!stateData) {
    return res.status(400).send(`<h1>❌ Invalid State</h1><p>State expired or invalid</p><a href="/">Try Again</a>`);
  }
  
  try {
    // Exchange code for token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.SLACK_REDIRECT_URI,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.ok) {
      throw new Error(tokenData.error || 'Token exchange failed');
    }
    
    // Clean up state
    pendingStates.delete(state);
    
    // Show success page with token
    const userToken = tokenData.authed_user?.access_token || 'No token generated';
    const userName = tokenData.authed_user?.name || stateData.user_name || 'Unknown User';
    const teamName = tokenData.team?.name || 'Unknown Team';
    const scopes = tokenData.authed_user?.scope || 'No scopes';
    
    const successHtml = `<!DOCTYPE html>
<html>
<head>
    <title>🎉 Token Generated Successfully</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
        .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .success-header { background: linear-gradient(135deg, #28a745, #20c997); color: white; padding: 25px; border-radius: 12px; margin: -30px -30px 30px -30px; text-align: center; }
        .token-section { background: #f8f9fa; border: 2px solid #28a745; padding: 20px; border-radius: 12px; margin: 20px 0; }
        .token-display { background: #ffffff; border: 2px dashed #28a745; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 14px; word-break: break-all; margin: 15px 0; }
        .copy-button { background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 10px 0; }
        .copy-button:hover { background: #218838; }
        .info { margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-header">
            <h1>🎉 Your Slack Token is Ready!</h1>
            <p>Copy your personal access token below</p>
        </div>
        
        <div class="token-section">
            <h3>🔑 Your Personal Access Token</h3>
            <p><strong>Copy this token immediately - it won't be shown again!</strong></p>
            
            <div class="token-display" id="tokenDisplay">${userToken}</div>
            
            <button class="copy-button" onclick="copyToken()">📋 Copy Token to Clipboard</button>
            <span id="copyStatus" style="color: #28a745; margin-left: 10px;"></span>
        </div>
        
        <div class="info">
            <p><strong>User:</strong> ${userName}</p>
            <p><strong>Team:</strong> ${teamName}</p>
            <p><strong>Permissions:</strong> ${scopes.replace(/,/g, ', ')}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <p><strong>⚠️ Security:</strong> Store this token securely and never share it publicly. You can revoke access anytime in your Slack app settings.</p>
    </div>

    <script>
        function copyToken() {
            const tokenDisplay = document.getElementById('tokenDisplay');
            const copyStatus = document.getElementById('copyStatus');
            
            const tempTextarea = document.createElement('textarea');
            tempTextarea.value = tokenDisplay.textContent.trim();
            document.body.appendChild(tempTextarea);
            tempTextarea.select();
            tempTextarea.setSelectionRange(0, 99999);
            
            try {
                document.execCommand('copy');
                copyStatus.textContent = '✅ Copied!';
                copyStatus.style.color = '#28a745';
                setTimeout(() => copyStatus.textContent = '', 3000);
            } catch (err) {
                copyStatus.textContent = '❌ Copy failed - please select and copy manually';
                copyStatus.style.color = '#dc3545';
            }
            
            document.body.removeChild(tempTextarea);
        }
        
        // Auto-select token when clicked
        document.getElementById('tokenDisplay').addEventListener('click', function() {
            const range = document.createRange();
            range.selectNode(this);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });
    </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(successHtml);
    
  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).send(`<h1>❌ Token Exchange Failed</h1><p>${error.message}</p><a href="/">Try Again</a>`);
  }
}
