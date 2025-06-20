#!/usr/bin/env node

/**
 * Slack User OAuth Token Generator - Direct Token Display
 * Shows tokens directly to users for immediate copying
 * No server-side storage, more secure approach
 */
import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';

// Add global error handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

process.on('warning', (warning) => {
  console.warn('⚠️ Warning:', warning.name);
  console.warn('Message:', warning.message);
  console.warn('Stack:', warning.stack);
});

class UserTokenGenerator {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    // Slack app credentials
    this.clientId = process.env.SLACK_CLIENT_ID;
    this.clientSecret = process.env.SLACK_CLIENT_SECRET;
    this.redirectUri = process.env.SLACK_REDIRECT_URI || `http://localhost:${this.port}/auth/callback`;
    
    // State management for OAuth (temporary, in-memory only)
    this.pendingStates = new Map();
    
    // Start periodic cleanup
    this.startStateCleanup();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  startStateCleanup() {
    // Clean up expired states every 5 minutes
    setInterval(() => {
      this.cleanupStates();
    }, 5 * 60 * 1000);
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static('public'));
    
    // Security headers
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });
  }

  // Input validation helper
  validateInput(input, maxLength = 100) {
    if (!input || typeof input !== 'string') return '';
    return input.trim().slice(0, maxLength).replace(/[<>\"'&]/g, '');
  }

  setupRoutes() {
    // Home page
    this.app.get('/', (req, res) => {
      console.log('🔍 Home page requested');
      res.send(this.getHomePage());
    });

    // Start OAuth flow
    this.app.get('/auth/start', (req, res) => {
      console.log('🔍 OAuth start requested');
      console.log('Client ID:', this.clientId);
      console.log('Redirect URI:', this.redirectUri);
      
      const state = crypto.randomBytes(16).toString('hex');
      const userId = this.validateInput(req.query.user_id);
      const userName = this.validateInput(req.query.user_name);
      
      // Store state for validation (temporary)
      this.pendingStates.set(state, {
        user_id: userId,
        user_name: userName,
        timestamp: Date.now()
      });
      
      // Only request the scopes that are configured in your Slack app
      const userScopes = [
        'channels:read',     // View basic information about public channels in a workspace
        'groups:read',       // View basic information about a user's private channels  
        'users:read'         // View people in a workspace
      ].join(',');
      
      // Only request user scopes (no conflicting bot scopes)
      const authUrl = `https://slack.com/oauth/v2/authorize?` +
        `client_id=${this.clientId}&` +
        `user_scope=${encodeURIComponent(userScopes)}&` +
        `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
        `state=${state}`;
      
      console.log('🔗 Auth URL:', authUrl);
      res.redirect(authUrl);
    });

    // OAuth callback with comprehensive error handling
    this.app.get('/auth/callback', async (req, res) => {
      console.log('🔄 OAuth callback received');
      console.log('Query params:', req.query);
      console.log('Request URL:', req.url);
      console.log('Request headers:', req.headers);
      
      const { code, state, error } = req.query;
      
      try {
        console.log('🔍 Checking for OAuth errors...');
        if (error) {
          console.error('❌ OAuth error from Slack:', error);
          return res.send(this.getErrorPage(`OAuth Error: ${error}`));
        }
        
        console.log('🔍 Checking for code and state...');
        if (!code || !state) {
          console.error('❌ Missing code or state:', { code: !!code, state: !!state });
          return res.send(this.getErrorPage('Missing authorization code or state'));
        }
        
        console.log('🔍 Validating state...');
        const stateData = this.pendingStates.get(state);
        if (!stateData) {
          console.error('❌ Invalid state:', state);
          console.log('Available states:', Array.from(this.pendingStates.keys()));
          return res.send(this.getErrorPage('Invalid or expired state parameter'));
        }
        
        console.log('✅ State validated:', stateData);
        
        console.log('🔄 Starting token exchange...');
        const tokenData = await this.exchangeCodeForToken(code).catch(err => {
          console.error('❌ Token exchange failed:', err);
          throw err;
        });
        console.log('✅ Token exchange completed');
        
        console.log('🔍 Checking token data...');
        if (!tokenData || !tokenData.authed_user || !tokenData.authed_user.access_token) {
          console.error('❌ Invalid token data received:', tokenData);
          throw new Error('Invalid token data received from Slack');
        }
        
        console.log('✅ Token data validated');
        
        // Clean up state immediately
        this.pendingStates.delete(state);
        console.log('🧹 State cleaned up');
        
        console.log('🎉 OAuth flow completed successfully - showing token to user');
        
        // Send token directly to user (NO SERVER STORAGE)
        try {
          console.log('📄 Generating success page...');
          const successPage = this.getSuccessPageWithToken(tokenData, stateData);
          console.log('✅ Success page generated');
          
          console.log('📤 Sending response to user...');
          res.send(successPage);
          console.log('✅ Token displayed to user');
          
          // Log successful token generation (without the actual token)
          console.log(`🎯 Token generated for user: ${tokenData.authed_user?.id || 'Unknown'} (${stateData.user_name || tokenData.authed_user?.name || 'Unknown'})`);
          
        } catch (pageError) {
          console.error('❌ Error generating success page:', pageError);
          console.error('Page error stack:', pageError.stack);
          res.status(500).send('Success! Token generated, but error displaying page. Check server logs.');
        }
        
      } catch (error) {
        console.error('❌ OAuth callback error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        try {
          res.send(this.getErrorPage(`Token exchange failed: ${error.message}`));
        } catch (responseError) {
          console.error('❌ Failed to send error page:', responseError);
          res.status(500).send('An error occurred during token generation.');
        }
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      try {
        res.json({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          mode: 'direct-token-display'
        });
      } catch (error) {
        res.status(500).json({ 
          status: 'error',
          message: 'Health check failed'
        });
      }
    });

    // Info endpoint
    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Slack User Token Generator',
        mode: 'Direct Token Display',
        description: 'Generates user tokens and displays them directly to users',
        security: 'No server-side token storage',
        version: '2.0.0'
      });
    });
  }

  async exchangeCodeForToken(code) {
    try {
      console.log('🔄 Making token exchange request to Slack...');
      console.log('📋 Request details:', {
        clientId: this.clientId ? 'Present' : 'Missing',
        clientSecret: this.clientSecret ? 'Present' : 'Missing',
        code: code ? 'Present' : 'Missing',
        redirectUri: this.redirectUri
      });
      
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
          redirect_uri: this.redirectUri,
        }),
      });

      console.log('📡 Slack API response status:', response.status, response.statusText);
      
      if (!response.ok) {
        console.error('❌ HTTP error from Slack:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('❌ Response body:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('📄 Slack response structure:', {
        ok: data.ok,
        hasAuthedUser: !!data.authed_user,
        hasAccessToken: !!(data.authed_user && data.authed_user.access_token),
        hasTeam: !!data.team,
        error: data.error
      });
      
      if (!data.ok) {
        console.error('❌ Slack API error:', data.error);
        console.error('❌ Full error response:', data);
        throw new Error(`OAuth exchange failed: ${data.error}`);
      }

      console.log('✅ Token exchange successful');
      return data;
    } catch (error) {
      console.error('❌ Exchange code error:', error);
      console.error('❌ Error type:', typeof error);
      console.error('❌ Error constructor:', error.constructor.name);
      throw error;
    }
  }

  cleanupStates() {
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    let cleaned = 0;
    
    for (const [state, data] of this.pendingStates.entries()) {
      if (now - data.timestamp > tenMinutes) {
        this.pendingStates.delete(state);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired OAuth states`);
    }
  }

  getHomePage() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Slack User Token Generator</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px; 
            line-height: 1.6;
            background: #f8f9fa;
        }
        .container { 
            background: white; 
            padding: 30px; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .button { 
            background: #4CAF50; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 8px; 
            display: inline-block; 
            margin: 15px 0; 
            border: none; 
            cursor: pointer;
            font-size: 16px;
            transition: background 0.3s;
        }
        .button:hover { background: #45a049; }
        .form-group { margin: 15px 0; }
        label { 
            display: block; 
            margin-bottom: 8px; 
            font-weight: 600;
            color: #333;
        }
        input { 
            width: 100%; 
            max-width: 400px;
            padding: 12px; 
            border: 2px solid #ddd; 
            border-radius: 8px;
            font-size: 14px;
        }
        input:focus {
            outline: none;
            border-color: #4CAF50;
        }
        .warning { 
            background: #fff3cd; 
            color: #856404; 
            padding: 15px; 
            border-radius: 8px; 
            margin: 15px 0; 
            border-left: 4px solid #ffc107;
        }
        .info { 
            background: #d4edda; 
            color: #155724; 
            padding: 15px; 
            border-radius: 8px; 
            margin: 15px 0; 
            border-left: 4px solid #28a745;
        }
        h1 { color: #333; margin-bottom: 10px; }
        h3 { color: #555; margin-top: 25px; }
        ul, ol { padding-left: 20px; }
        li { margin: 8px 0; }
        .security-note {
            background: #e3f2fd;
            color: #1565c0;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            border-left: 4px solid #2196f3;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Slack User Token Generator</h1>
        
        <div class="warning">
            <strong>⚠️ Important:</strong> This will generate a personal access token for your Slack account. 
            Only proceed if you understand what you're authorizing.
        </div>
        
        <div class="info">
            <strong>✅ This app will request permissions to:</strong>
            <ul>
                <li>View basic information about public channels in your workspace</li>
                <li>View basic information about your private channels</li>
                <li>View people in the workspace</li>
            </ul>
        </div>

        <div class="security-note">
            <strong>🛡️ Security & Privacy:</strong>
            <ul>
                <li><strong>No Storage:</strong> Your token is never stored on our servers</li>
                <li><strong>Direct Display:</strong> The token appears only on your screen for copying</li>
                <li><strong>Your Control:</strong> You can revoke access anytime in Slack settings</li>
                <li><strong>Secure Connection:</strong> All communication is encrypted</li>
            </ul>
        </div>
        
        <form action="/auth/start" method="get">
            <div class="form-group">
                <label for="user_id">Your User ID (optional):</label>
                <input type="text" id="user_id" name="user_id" placeholder="e.g., john.doe or U1234567890" maxlength="100">
                <small style="color: #666;">This helps identify you in logs (optional)</small>
            </div>
            
            <div class="form-group">
                <label for="user_name">Your Name (optional):</label>
                <input type="text" id="user_name" name="user_name" placeholder="e.g., John Doe" maxlength="100">
                <small style="color: #666;">For display purposes only (optional)</small>
            </div>
            
            <button type="submit" class="button">🚀 Generate My Slack Token</button>
        </form>
        
        <h3>What happens next?</h3>
        <ol>
            <li><strong>Slack Authorization:</strong> You'll be redirected to Slack to review and approve permissions</li>
            <li><strong>Token Generation:</strong> Slack generates your personal access token</li>
            <li><strong>Direct Display:</strong> Your token appears on screen for immediate copying</li>
            <li><strong>Use Immediately:</strong> Copy and use your token right away</li>
        </ol>
        
        <h3>After You Get Your Token:</h3>
        <ul>
            <li>📋 <strong>Copy it immediately</strong> - it won't be shown again</li>
            <li>🔒 <strong>Store it securely</strong> - treat it like a password</li>
            <li>⚡ <strong>Use it in your app</strong> - paste it where needed</li>
            <li>🚫 <strong>Revoke when done</strong> - remove access in Slack if no longer needed</li>
        </ul>
    </div>
</body>
</html>`;
  }

  getSuccessPageWithToken(tokenData, stateData) {
    try {
      console.log('📄 Generating success page with token...');
      
      // Safe access with fallbacks
      const userName = tokenData?.authed_user?.name || stateData?.user_name || 'Unknown User';
      const userId = tokenData?.authed_user?.id || 'Unknown ID';
      const teamName = tokenData?.team?.name || 'Unknown Team';
      const scopes = tokenData?.authed_user?.scope || 'No scopes';
      const userToken = tokenData?.authed_user?.access_token || 'No token generated';
      
      console.log('✅ Success page data prepared (token hidden in logs)');
      
      return `
<!DOCTYPE html>
<html>
<head>
    <title>🎉 Token Generated Successfully</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            max-width: 900px; 
            margin: 0 auto; 
            padding: 20px; 
            line-height: 1.6;
            background: #f8f9fa;
        }
        .container { 
            background: white; 
            padding: 30px; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .success-header {
            background: linear-gradient(135deg, #28a745, #20c997);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin: -30px -30px 30px -30px;
            text-align: center;
        }
        .token-section {
            background: #f8f9fa;
            border: 2px solid #28a745;
            padding: 20px;
            border-radius: 12px;
            margin: 20px 0;
        }
        .token-display {
            background: #ffffff;
            border: 2px dashed #28a745;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 14px;
            word-break: break-all;
            margin: 15px 0;
            position: relative;
        }
        .copy-button {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin: 10px 0;
            transition: background 0.3s;
        }
        .copy-button:hover { background: #218838; }
        .copy-button:active { background: #1e7e34; }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .info-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #28a745;
        }
        .info-item strong {
            color: #155724;
            display: block;
            margin-bottom: 5px;
        }
        .warning {
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #ffc107;
        }
        .next-steps {
            background: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .next-steps h3 {
            color: #1565c0;
            margin-top: 0;
        }
        .next-steps ol {
            color: #1976d2;
        }
        .security-reminder {
            background: #ffebee;
            color: #c62828;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #f44336;
        }
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
            
            <div class="token-display" id="tokenDisplay">
                ${userToken}
            </div>
            
            <button class="copy-button" onclick="copyToken()">
                📋 Copy Token to Clipboard
            </button>
            <span id="copyStatus" style="color: #28a745; margin-left: 10px;"></span>
        </div>
        
        <div class="info-grid">
            <div class="info-item">
                <strong>User:</strong>
                ${userName}
            </div>
            <div class="info-item">
                <strong>User ID:</strong>
                ${userId}
            </div>
            <div class="info-item">
                <strong>Team:</strong>
                ${teamName}
            </div>
            <div class="info-item">
                <strong>Permissions:</strong>
                ${scopes.replace(/,/g, ', ')}
            </div>
        </div>
        
        <div class="next-steps">
            <h3>📋 Next Steps</h3>
            <ol>
                <li><strong>Copy the token above</strong> using the copy button</li>
                <li><strong>Store it securely</strong> - treat it like a password</li>
                <li><strong>Use it in your application</strong> - paste where needed</li>
                <li><strong>Test the connection</strong> - verify it works as expected</li>
            </ol>
        </div>
        
        <div class="warning">
            <strong>⚠️ Important Security Notes:</strong>
            <ul>
                <li>This token grants access to your Slack account with the permissions shown above</li>
                <li>Never share this token publicly or commit it to version control</li>
                <li>Store it in environment variables or secure configuration</li>
                <li>The token is not stored on our servers - only you have access to it</li>
            </ul>
        </div>
        
        <div class="security-reminder">
            <h4>🛡️ Security Reminder</h4>
            <p>You can revoke this token anytime by going to your Slack workspace settings → Apps → Manage → Find this app → Remove. This will immediately disable the token.</p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d;">
                Generated: ${new Date().toLocaleString()}<br>
                <small>Close this window once you've copied your token</small>
            </p>
        </div>
    </div>

    <script>
        function copyToken() {
            const tokenDisplay = document.getElementById('tokenDisplay');
            const copyStatus = document.getElementById('copyStatus');
            
            // Create a temporary textarea to select and copy the text
            const tempTextarea = document.createElement('textarea');
            tempTextarea.value = tokenDisplay.textContent.trim();
            document.body.appendChild(tempTextarea);
            tempTextarea.select();
            tempTextarea.setSelectionRange(0, 99999); // For mobile devices
            
            try {
                document.execCommand('copy');
                copyStatus.textContent = '✅ Copied!';
                copyStatus.style.color = '#28a745';
                
                // Clear the success message after 3 seconds
                setTimeout(() => {
                    copyStatus.textContent = '';
                }, 3000);
                
            } catch (err) {
                copyStatus.textContent = '❌ Copy failed - please select and copy manually';
                copyStatus.style.color = '#dc3545';
            }
            
            document.body.removeChild(tempTextarea);
        }
        
        // Auto-select token text when clicked
        document.getElementById('tokenDisplay').addEventListener('click', function() {
            const range = document.createRange();
            range.selectNode(this);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });
        
        // Show a warning if user tries to leave without copying
        let tokenCopied = false;
        document.querySelector('.copy-button').addEventListener('click', function() {
            tokenCopied = true;
        });
        
        window.addEventListener('beforeunload', function(e) {
            if (!tokenCopied) {
                e.preventDefault();
                e.returnValue = 'Have you copied your token? It won\\'t be shown again.';
            }
        });
    </script>
</body>
</html>`;
    } catch (error) {
      console.error('❌ Error generating success page:', error);
      return `
<!DOCTYPE html>
<html>
<head><title>Success</title></head>
<body>
    <h1>✅ Token Generated Successfully!</h1>
    <p>Your token: <code>${tokenData?.authed_user?.access_token || 'Error displaying token'}</code></p>
    <p>Please copy this token immediately and store it securely.</p>
</body>
</html>`;
    }
  }

  getErrorPage(errorMessage) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Authorization Error</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            background: #f8f9fa;
        }
        .container { 
            background: white;
            padding: 30px; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .error-header {
            background: linear-gradient(135deg, #dc3545, #c82333);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin: -30px -30px 30px -30px;
            text-align: center;
        }
        .button { 
            background: #007bff; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 8px; 
            display: inline-block; 
            margin: 15px 0;
            transition: background 0.3s;
        }
        .button:hover { background: #0056b3; }
        .error-details {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #dc3545;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-header">
            <h1>❌ Authorization Failed</h1>
            <p>Something went wrong during token generation</p>
        </div>
        
        <div class="error-details">
            <strong>Error Details:</strong><br>
            ${errorMessage}
        </div>
        
        <p>Please try again or contact your administrator if the problem persists.</p>
        
        <a href="/" class="button">← Try Again</a>
    </div>
</body>
</html>`;
  }

  start() {
    if (!this.clientId || !this.clientSecret) {
      console.error('❌ Missing required environment variables:');
      console.error('   SLACK_CLIENT_ID - Your Slack app client ID');
      console.error('   SLACK_CLIENT_SECRET - Your Slack app client secret');
      process.exit(1);
    }

    // Add error handling to the Express app
    this.app.use((error, req, res, next) => {
      console.error('🚨 Express error handler caught:', error);
      console.error('Error stack:', error.stack);
      res.status(500).send('Internal server error - check server logs');
    });

    const server = this.app.listen(this.port, () => {
      console.log('🚀 Slack User Token Generator (Direct Display Mode)');
      console.log('🌐 Server running on: http://localhost:' + this.port);
      console.log('🔒 Security: No server-side token storage');
      console.log('📋 Mode: Direct token display to users');
      console.log('\n📋 How to use:');
      console.log('   1. Visit: http://localhost:' + this.port);
      console.log('   2. Users authorize access through Slack');
      console.log('   3. Tokens are displayed directly for immediate copying');
      console.log('   4. No admin management needed - tokens never stored');
      console.log('\n🔧 Endpoints:');
      console.log('   GET / - Token generation interface');
      console.log('   GET /health - Health check');
      console.log('   GET /info - App information');
      console.log('\n🟢 Ready for token generation!');
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('🚨 Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error('❌ Port ' + this.port + ' is already in use');
        console.error('💡 Try using a different port: PORT=3001 node server.js');
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('✅ Server closed');
      });
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });
  }
}

// Start the server with error handling
try {
  console.log('🚀 Starting Slack User Token Generator (Direct Display Mode)...');
  const generator = new UserTokenGenerator();
  generator.start();
} catch (error) {
  console.error('💥 Failed to start server:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}