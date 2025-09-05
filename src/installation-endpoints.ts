// Installation endpoints for GitHub App
import { Hono } from "hono";
import { Env, GitHubAppConfig } from "./types";

export function addInstallationEndpoints(app: Hono<{ Bindings: Env }>) {
  // Serve installation page
  app.get("/install", async (c) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Install Claude Code GitHub App</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
            text-align: center;
        }
        
        .logo {
            width: 80px;
            height: 80px;
            background: #24292f;
            border-radius: 16px;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            color: white;
        }
        
        h1 {
            color: #24292f;
            font-size: 32px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .subtitle {
            color: #656d76;
            font-size: 18px;
            margin-bottom: 32px;
            line-height: 1.5;
        }
        
        .features {
            background: #f6f8fa;
            border-radius: 12px;
            padding: 24px;
            margin: 32px 0;
            text-align: left;
        }
        
        .features h3 {
            color: #24292f;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .feature-list {
            list-style: none;
        }
        
        .feature-list li {
            color: #656d76;
            margin-bottom: 8px;
            padding-left: 24px;
            position: relative;
        }
        
        .feature-list li::before {
            content: "✓";
            color: #22c55e;
            font-weight: bold;
            position: absolute;
            left: 0;
        }
        
        .install-button {
            background: #238636;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 16px 32px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-block;
            margin: 16px 0;
        }
        
        .install-button:hover {
            background: #2ea043;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(35, 134, 54, 0.3);
        }
        
        .install-button:active {
            transform: translateY(0);
        }
        
        .permissions {
            background: #fff8e1;
            border: 1px solid #ffecb3;
            border-radius: 8px;
            padding: 16px;
            margin: 24px 0;
            text-align: left;
        }
        
        .permissions h4 {
            color: #e65100;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .permissions ul {
            list-style: disc;
            padding-left: 20px;
        }
        
        .permissions li {
            color: #bf5f00;
            font-size: 14px;
            margin-bottom: 4px;
        }
        
        .status {
            margin-top: 24px;
            padding: 16px;
            border-radius: 8px;
            display: none;
        }
        
        .status.success {
            background: #dcfce7;
            border: 1px solid #bbf7d0;
            color: #15803d;
            display: block;
        }
        
        .status.error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #dc2626;
            display: block;
        }
        
        .github-logo {
            display: inline-block;
            margin-right: 8px;
            vertical-align: middle;
        }
        
        .loading {
            display: none;
            margin-top: 16px;
        }
        
        .spinner {
            border: 2px solid #f3f3f3;
            border-top: 2px solid #238636;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-right: 8px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">⚡</div>
        
        <h1>Install Claude Code GitHub App</h1>
        
        <p class="subtitle">
            Automate your GitHub workflow with AI-powered code analysis and issue processing
        </p>
        
        <div class="features">
            <h3>What this app will do:</h3>
            <ul class="feature-list">
                <li>Automatically analyze GitHub issues and provide intelligent responses</li>
                <li>Generate pull requests with code fixes and improvements</li>
                <li>Process repository analysis and provide insights</li>
                <li>Integrate with Claude AI for advanced code understanding</li>
            </ul>
        </div>
        
        <div class="permissions">
            <h4>⚠️ Required Permissions:</h4>
            <ul>
                <li>Issues (Read & Write) - to process and respond to issues</li>
                <li>Pull Requests (Read & Write) - to create automated fixes</li>
                <li>Contents (Read & Write) - to analyze and modify code</li>
                <li>Metadata (Read) - to access repository information</li>
            </ul>
        </div>
        
        <button id="installButton" class="install-button" onclick="startInstallation()">
            <span class="github-logo">📱</span>
            Install on GitHub
        </button>
        
        <div id="loading" class="loading">
            <div class="spinner"></div>
            Redirecting to GitHub...
        </div>
        
        <div id="status" class="status"></div>
        
        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e1e4e8; color: #656d76; font-size: 14px;">
            <p>
                🔒 Secure installation process powered by GitHub Apps.<br>
                You can review and modify permissions after installation.
            </p>
        </div>
    </div>

    <script>
        // Check URL parameters for callback handling
        const urlParams = new URLSearchParams(window.location.search);
        const installationId = urlParams.get('installation_id');
        const setupAction = urlParams.get('setup_action');
        
        // If we have installation_id, this is a callback from GitHub
        if (installationId) {
            handleInstallationCallback(installationId, setupAction);
        }
        
        async function startInstallation() {
            const button = document.getElementById('installButton');
            const loading = document.getElementById('loading');
            const status = document.getElementById('status');
            
            try {
                button.style.display = 'none';
                loading.style.display = 'block';
                status.style.display = 'none';
                
                // Get installation URL from our API
                const response = await fetch('/install/github-app');
                const data = await response.json();
                
                if (data.installation_url) {
                    // Redirect to GitHub for installation
                    window.location.href = data.installation_url;
                } else {
                    throw new Error('Failed to get installation URL');
                }
                
            } catch (error) {
                console.error('Installation error:', error);
                button.style.display = 'inline-block';
                loading.style.display = 'none';
                showStatus('error', 'Failed to start installation. Please try again.');
            }
        }
        
        async function handleInstallationCallback(installationId, setupAction) {
            const status = document.getElementById('status');
            const button = document.getElementById('installButton');
            
            try {
                // Notify our backend about the installation
                const response = await fetch(\`/install/callback?installation_id=\${installationId}&setup_action=\${setupAction || 'install'}\`);
                const data = await response.json();
                
                if (data.success) {
                    button.style.display = 'none';
                    showStatus('success', \`
                        🎉 Installation successful! Installation ID: \${installationId}<br><br>
                        <strong>Next steps:</strong><br>
                        1. Configure your GitHub App credentials via the /config endpoint<br>
                        2. Set up webhook URL: \${data.next_steps?.webhook_url || ''}<br>
                        3. Test your integration
                    \`);
                } else {
                    throw new Error(data.error || 'Installation callback failed');
                }
                
            } catch (error) {
                console.error('Callback error:', error);
                showStatus('error', \`Installation callback failed: \${error.message}\`);
            }
        }
        
        function showStatus(type, message) {
            const status = document.getElementById('status');
            status.className = \`status \${type}\`;
            status.innerHTML = message;
            status.style.display = 'block';
        }
        
        // Auto-hide loading after 5 seconds as fallback
        setTimeout(() => {
            const loading = document.getElementById('loading');
            if (loading.style.display === 'block') {
                loading.style.display = 'none';
                document.getElementById('installButton').style.display = 'inline-block';
                showStatus('error', 'Redirect timeout. Please try again.');
            }
        }, 5000);
    </script>
</body>
</html>`;
    
    return c.html(html);
  });
  // Get GitHub App installation URL
  app.get("/install/github-app", async (c) => {
    // You need to replace 'your-app-name' with your actual GitHub App slug
    const appName = "your-app-name"; // TODO: Set this to your actual GitHub App slug
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/install/callback`;
    
    return c.json({
      installation_url: `https://github.com/apps/${appName}/installations/new`,
      app_name: appName,
      callback_url: callbackUrl,
      setup_url_note: "Make sure to set this callback_url as your GitHub App's Setup URL",
      multi_tenant_note: "This is a service provider controlled GitHub App. Users only need the Installation ID.",
      instructions: {
        step_1: "Click the installation_url to install the GitHub App",
        step_2: "Select repositories you want to grant access to", 
        step_3: "GitHub will redirect back to callback_url with installation_id",
        step_4: "Copy your installation_id and use it with /register-user endpoint",
        step_5: "Provide your Anthropic API key when registering",
        step_6: "Deploy your own Cloudflare Worker with your user credentials"
      }
    });
  });

  // Handle GitHub installation callback
  app.get("/install/callback", async (c) => {
    try {
      const installation_id = c.req.query("installation_id");
      const setup_action = c.req.query("setup_action");
      const code = c.req.query("code");

      if (!installation_id) {
        return c.json({ error: "installation_id is required" }, 400);
      }

      // TODO: Validate installation with GitHub API
      // const installationDetails = await validateInstallation(installation_id);
      
      return c.json({
        success: true,
        installation_id,
        setup_action: setup_action || "install",
        message: "GitHub App installation successful!",
        next_steps: {
          step_1: `Register as a user: POST ${new URL(c.req.url).origin}/register-user`,
          step_2: "Deploy your own Cloudflare Worker",
          step_3: `Configure webhook URL in your Worker: ${new URL(c.req.url).origin}/webhook/github`,
          required_data: {
            installation_id,
            anthropic_api_key: "Your Anthropic API key"
          }
        },
        registration_example: {
          method: "POST",
          url: `${new URL(c.req.url).origin}/register-user`,
          body: {
            installationId: installation_id,
            anthropicApiKey: "your-anthropic-api-key-here",
            userId: "optional-custom-user-id"
          }
        },
        note: "This GitHub App is managed by the service provider. You only need your Installation ID and Anthropic API key."
      });

    } catch (error) {
      console.error("Installation callback error:", error);
      return c.json({ 
        error: "Installation callback failed", 
        details: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });

  // Check installation status
  app.get("/install/status/:installation_id", async (c) => {
    try {
      const installation_id = c.req.param("installation_id");
      
      // Get configuration from Durable Object
      const configId = c.env.GITHUB_APP_CONFIG.idFromName("default");
      const configStub = c.env.GITHUB_APP_CONFIG.get(configId);
      const config = await configStub.fetch(new Request("http://internal/config")).then(r => r.json()) as GitHubAppConfig | null;

      if (!config) {
        return c.json({
          installation_id,
          status: "not_configured",
          message: "GitHub App not configured. Use POST /config to set up credentials."
        });
      }

      // TODO: Check with GitHub API
      // const installationInfo = await getInstallationInfo(installation_id, config);

      return c.json({
        installation_id,
        status: "configured", // or "active", "suspended", etc.
        message: "Installation found in configuration",
        config_status: {
          appId: config.appId ? "✓" : "✗",
          privateKey: config.privateKey ? "✓" : "✗", 
          webhookSecret: config.webhookSecret ? "✓" : "✗",
          installationId: config.installationId === installation_id ? "✓" : "✗"
        }
      });

    } catch (error) {
      console.error("Installation status check error:", error);
      return c.json({ 
        error: "Status check failed", 
        details: error instanceof Error ? error.message : "Unknown error"
      }, 500);
    }
  });
}

// Helper function to validate installation (TODO: implement)
async function validateInstallation(installation_id: string, app_id?: string, private_key?: string) {
  // Implementation would:
  // 1. Create JWT token for GitHub App
  // 2. Call GET /app/installations/{installation_id}
  // 3. Return installation details
  throw new Error("Not implemented yet");
}

// Helper function to get installation info (TODO: implement) 
async function getInstallationInfo(installation_id: string, config: GitHubAppConfig) {
  // Implementation would:
  // 1. Create JWT from app_id and private_key
  // 2. Call GitHub API to get installation details
  // 3. Return parsed installation information
  throw new Error("Not implemented yet");
}
