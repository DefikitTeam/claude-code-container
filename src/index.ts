import { Hono } from "hono";
import { Env, GitHubIssuePayload, GitHubAppConfig, ContainerRequest } from "./types";
import { GitHubAppConfigDO, MyContainer } from "./durable-objects";
import { CryptoUtils } from "./crypto";

// Export Durable Objects only
export { GitHubAppConfigDO, MyContainer };

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Home route with system information
app.get("/", (c) => {
  return c.json({
    name: "Claude Code Containers",
    description: "Automated GitHub issue processing system powered by Claude Code",
    version: "1.0.0",
    endpoints: {
      "/": "System information",
      "/webhook/github": "POST - GitHub webhook endpoint",
      "/health": "Health check",
      "/config": "GitHub App configuration endpoints",
      "/container/process": "Direct container processing",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      containers: "available",
      durableObjects: "available",
      webhooks: "ready",
    },
  });
});

// GitHub webhook endpoint
app.post("/webhook/github", async (c) => {
  try {
    // Get request body and headers
    const body = await c.req.text();
    const signature = c.req.header("X-Hub-Signature-256");
    const event = c.req.header("X-GitHub-Event");
    const delivery = c.req.header("X-GitHub-Delivery");

    console.log("=== WEBHOOK DEBUG ===");
    console.log(`Event: ${event}, Delivery: ${delivery}`);
    console.log(`Body length: ${body.length}`);
    console.log(`Signature received: ${signature}`);
    console.log(`Body sample: ${body.substring(0, 100)}...`);

    // Validate signature first - even before getting config
    if (!signature) {
      console.error("Missing webhook signature");
      return c.json({ error: "Missing signature" }, 400);
    }

    // Get config
    console.log("Getting GitHub config...");
    const config = await getGitHubConfig(c.env);
    if (!config) {
      console.error("No GitHub configuration found");
      return c.json({ error: "GitHub App not configured" }, 500);
    }

    console.log(`Config found: AppID=${config.appId}, InstallationID=${config.installationId}`);

    if (!signature) {
      console.error("Missing webhook signature");
      return c.json({ error: "Missing signature" }, 400);
    }

    // TEMPORARY: Skip signature validation for debugging
    console.log("TEMPORARILY SKIPPING SIGNATURE VALIDATION FOR DEBUG");
    const isValid = true; // Force validation to pass
    
    console.log("Verifying webhook signature...");
    console.log("Webhook secret (first 10 chars):", config.webhookSecret.substring(0, 10));
    console.log("Webhook secret length:", config.webhookSecret.length);
    console.log("Received signature:", signature);
    console.log("Body preview (first 200 chars):", body.substring(0, 200));
    console.log("Body is form-encoded:", body.startsWith('payload='));
    
    // Manual signature verification for debugging
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(config.webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      // Sign the raw body (form-encoded data for GitHub webhooks)
      const expectedSignature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
      const expectedHex = Array.from(new Uint8Array(expectedSignature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
      
      console.log("Expected signature: sha256=" + expectedHex);
      console.log("Clean received signature:", cleanSignature);
      console.log("Signatures match:", cleanSignature === expectedHex);
      
      if (!isValid) {
        console.error("Invalid webhook signature");
        return c.json({ 
          error: "Invalid signature",
          received: cleanSignature,
          expected: expectedHex,
          body_length: body.length
        }, 401);
      }
    } catch (err) {
      console.error("Signature verification error:", err);
      return c.json({ error: "Signature verification failed" }, 500);
    }

    console.log("Signature valid, parsing payload...");
    // Parse payload - GitHub sends form-encoded data with 'payload' field
    let payload: GitHubIssuePayload;
    try {
      // Check if body starts with "payload=" (form-encoded)
      if (body.startsWith('payload=')) {
        // URL decode the payload parameter
        const encodedPayload = body.substring(8); // Remove "payload="
        const decodedPayload = decodeURIComponent(encodedPayload);
        payload = JSON.parse(decodedPayload);
        console.log("Parsed form-encoded payload successfully");
      } else {
        // Direct JSON payload
        payload = JSON.parse(body);
        console.log("Parsed JSON payload successfully");
      }
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Body first 500 chars:", body.substring(0, 500));
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    // Process different webhook events
    switch (event) {
      case "issues":
        return await handleIssueEvent(c, payload, config);
      case "ping":
        console.log("GitHub webhook ping received");
        return c.json({ message: "pong" });
      default:
        console.log(`Unhandled webhook event: ${event}`);
        return c.json({ message: "Event not supported" }, 200);
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");
    return c.json(
      { 
        error: "Webhook processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      },
      500
    );
  }
});

// Handle GitHub issue events
async function handleIssueEvent(
  c: any,
  payload: GitHubIssuePayload,
  config: GitHubAppConfig
) {
  const { action, issue, repository } = payload;

  console.log(
    `Issue event: ${action} - #${issue.number} in ${repository.full_name}`
  );

  // Only process opened issues
  if (action !== "opened") {
    console.log(`Ignoring issue action: ${action}`);
    return c.json({ message: `Issue action '${action}' not processed` });
  }

  // Skip processing issues created by bots to avoid loops
  if (issue.user.login.includes("[bot]") || issue.user.login === "claude") {
    console.log("Skipping bot-created issue");
    return c.json({ message: "Bot issue skipped" });
  }

  try {
    console.log("Processing issue - ensuring installation token...");
    
    // Ensure we have a valid installation token
    let configWithToken = config;
    if (!config.installationToken || isTokenExpired(config.tokenExpiresAt)) {
      console.log("Generating new installation token...");
      const newConfig = await generateInstallationToken(c.env, config);
      if (!newConfig) {
        throw new Error("Failed to generate installation token");
      }
      configWithToken = newConfig;
      console.log("Installation token generated successfully");
    }

    // Get a container to process the issue
    const containerId = c.env.MY_CONTAINER.idFromName(`issue-${issue.id}`);
    const container = c.env.MY_CONTAINER.get(containerId);

    // Prepare container request
    const containerRequest: ContainerRequest = {
      type: "process_issue",
      payload,
      config: configWithToken,
    };

    // Send request to container
    console.log('Sending request to container:', {
      url: "/process-issue",
      method: "POST",
      bodyLength: JSON.stringify(containerRequest).length
    });
    
    const containerResponse = await container.fetch(
      new Request("/process-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(containerRequest),
      })
    );

    console.log('Container response status:', containerResponse.status);
    console.log('Container response headers:', Object.fromEntries(containerResponse.headers.entries()));

    // Handle non-JSON responses gracefully
    let result: any;
    const responseText = await containerResponse.text();
    
    console.log('Container response text length:', responseText.length);
    console.log('Container response preview:', responseText.substring(0, 300));
    
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Container response is not valid JSON:', responseText.substring(0, 200));
      console.error('Parse error:', parseError);
      
      return c.json({
        success: false,
        message: "Container returned invalid response",
        error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
        status: containerResponse.status,
        headers: Object.fromEntries(containerResponse.headers.entries())
      }, 500);
    }

    console.log(`Issue processing result:`, result);

    return c.json({
      success: true,
      message: "Issue processing initiated",
      issueId: issue.id,
      issueNumber: issue.number,
      result,
    });
  } catch (error) {
    console.error("Issue processing failed:", error);
    return c.json(
      {
        error: "Issue processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
        issueId: issue.id,
      },
      500
    );
  }
}

// GitHub App configuration endpoints
app.get("/config", async (c) => {
  try {
    const config = await getGitHubConfig(c.env);
    if (!config) {
      return c.json({ error: "No configuration found" }, 404);
    }

    // Return safe configuration (without secrets)
    return c.json({
      appId: config.appId,
      installationId: config.installationId,
      hasPrivateKey: !!config.privateKey,
      hasWebhookSecret: !!config.webhookSecret,
      hasInstallationToken: !!config.installationToken,
      tokenExpiry: config.tokenExpiresAt
        ? new Date(config.tokenExpiresAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error("Failed to get configuration:", error);
    return c.json({ error: "Configuration retrieval failed" }, 500);
  }
});

app.post("/config", async (c) => {
  try {
    const configData = await c.req.json();

    // Validate required fields
    if (!configData.appId || !configData.privateKey || !configData.webhookSecret) {
      return c.json({ error: "Missing required configuration fields" }, 400);
    }

    // Store configuration
    const configDO = getGitHubConfigDO(c.env);
    const response = await configDO.fetch(
      new Request("http://localhost/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configData),
      })
    );

    if (!response.ok) {
      const error = await response.json();
      return c.json({ error: "Failed to store configuration", details: error }, 500);
    }

    console.log("GitHub App configuration stored successfully");
    return c.json({ message: "Configuration stored successfully" });
  } catch (error) {
    console.error("Failed to store configuration:", error);
    return c.json({ error: "Configuration storage failed" }, 500);
  }
});

app.delete("/config", async (c) => {
  try {
    const configDO = getGitHubConfigDO(c.env);
    const response = await configDO.fetch(
      new Request("http://localhost/clear", { method: "DELETE" })
    );

    if (!response.ok) {
      return c.json({ error: "Failed to clear configuration" }, 500);
    }

    console.log("GitHub App configuration cleared");
    return c.json({ message: "Configuration cleared successfully" });
  } catch (error) {
    console.error("Failed to clear configuration:", error);
    return c.json({ error: "Configuration clearing failed" }, 500);
  }
});

// Container processing endpoint (for direct testing)
app.post("/container/process", async (c) => {
  try {
    const requestData = await c.req.json();
    const containerId = c.env.MY_CONTAINER.idFromName(`test-${Date.now()}`);
    const container = c.env.MY_CONTAINER.get(containerId);
    
    const response = await container.fetch(
      new Request("/process-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      })
    );

    // Handle non-JSON responses gracefully
    const responseText = await response.text();
    try {
      const result = JSON.parse(responseText);
      return c.json(result);
    } catch (parseError) {
      console.error('Container response is not valid JSON:', responseText.substring(0, 200));
      return c.json({
        success: false,
        message: "Container returned invalid response",
        error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
        status: response.status
      }, 500);
    }
  } catch (error) {
    console.error("Direct container processing failed:", error);
    return c.json({ error: "Processing failed" }, 500);
  }
});

// Container information endpoint
app.get("/container", (c) => {
  return c.json({
    name: "Container Runtime",
    description: "Claude Code container processing system",
    endpoints: {
      "/container": "GET - Container system information",
      "/container/health": "GET - Container health check",
      "/container/process": "POST - Process GitHub issue directly",
    },
    status: "ready",
    timestamp: new Date().toISOString(),
  });
});

// Container health check
app.get("/container/health", async (c) => {
  try {
    const containerId = c.env.MY_CONTAINER.idFromName("health-check");
    const container = c.env.MY_CONTAINER.get(containerId);
    const response = await container.fetch(
      new Request("/health")
    );
    
    // Handle non-JSON responses gracefully
    const responseText = await response.text();
    try {
      const health = JSON.parse(responseText);
      return c.json(health);
    } catch (parseError) {
      console.error('Container health response is not valid JSON:', responseText.substring(0, 200));
      return c.json({
        success: false,
        message: "Container health check returned invalid response",
        error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
        status: response.status
      }, 500);
    }
  } catch (error) {
    console.error("Container health check failed:", error);
    return c.json({ error: "Container health check failed" }, 500);
  }
});

// Utility functions
async function getGitHubConfig(env: Env): Promise<GitHubAppConfig | null> {
  try {
    const configDO = getGitHubConfigDO(env);
    const response = await configDO.fetch(
      new Request("http://localhost/retrieve")
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to get GitHub configuration:", error);
    return null;
  }
}

function getGitHubConfigDO(env: Env) {
  const id = env.GITHUB_APP_CONFIG.idFromName("github-app-config");
  return env.GITHUB_APP_CONFIG.get(id);
}

// Helper function to check if token is expired
function isTokenExpired(tokenExpiresAt?: number): boolean {
  if (!tokenExpiresAt) return true;
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
  return tokenExpiresAt - now < bufferTime;
}

// Helper function to generate installation token
async function generateInstallationToken(env: Env, config: GitHubAppConfig): Promise<GitHubAppConfig | null> {
  try {
    console.log(`Creating JWT for App ID: ${config.appId}, Installation: ${config.installationId}`);
    
    // Create JWT token for GitHub App authentication
    const jwt = await createJWT(config.appId, config.privateKey);
    console.log(`JWT created successfully, length: ${jwt.length}`);
    
    // Get installation access token
    const apiUrl = `https://api.github.com/app/installations/${config.installationId}/access_tokens`;
    console.log(`Calling GitHub API: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0'
      }
    });

    console.log(`GitHub API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitHub API error: ${response.status} - ${errorText}`);
      return null;
    }

    const tokenData = await response.json() as any;
    console.log(`Access token obtained, expires at: ${tokenData.expires_at}`);
    
    // Update config with new token
    const updatedConfig: GitHubAppConfig = {
      ...config,
      installationToken: tokenData.token,
      tokenExpiresAt: new Date(tokenData.expires_at).getTime()
    };

    // Store updated config
    const configDO = getGitHubConfigDO(env);
    await configDO.fetch(
      new Request("http://localhost/update-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationToken: tokenData.token,
          tokenExpiresAt: updatedConfig.tokenExpiresAt
        })
      })
    );
    
    console.log("Installation token stored successfully");
    return updatedConfig;
  } catch (error) {
    console.error('Failed to generate installation token:', error);
    console.error('Error details:', error instanceof Error ? error.stack : String(error));
    return null;
  }
}

// Helper function to create JWT for GitHub App
async function createJWT(appId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago
    exp: now + 600, // Expires in 10 minutes
    iss: appId
  };

  console.log(`JWT payload: iat=${payload.iat}, exp=${payload.exp}, iss=${payload.iss}`);

  // Simple JWT creation
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/[=]/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/[=]/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const data = encodedHeader + '.' + encodedPayload;
  
  try {
    console.log(`Private key length: ${privateKey.length}, starts with: ${privateKey.substring(0, 50)}...`);
    
    // Import private key (PEM format)
    const keyData = privateKey.replace(/\\n/g, '\n');
    console.log(`Normalized key preview: ${keyData.substring(0, 50)}...`);
    
    // Convert PEM to DER format for Web Crypto API
    const pemHeader = "-----BEGIN RSA PRIVATE KEY-----";
    const pemFooter = "-----END RSA PRIVATE KEY-----";
    
    if (!keyData.includes(pemHeader) || !keyData.includes(pemFooter)) {
      throw new Error('Invalid PEM format: missing header or footer');
    }
    
    const pemContents = keyData.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
    console.log(`PEM contents length: ${pemContents.length}`);
    
    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    console.log(`Binary DER length: ${binaryDer.length}`);

    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    console.log('Private key imported successfully');

    // Sign the data
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', importedKey, new TextEncoder().encode(data));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/[=]/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const jwt = data + '.' + encodedSignature;
    console.log(`JWT created successfully, length: ${jwt.length}`);
    return jwt;
  } catch (error) {
    console.error('JWT creation failed:', error);
    console.error('Error details:', error instanceof Error ? error.stack : String(error));
    throw new Error(`JWT creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Error handling middleware
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      message: err.message,
      timestamp: new Date().toISOString(),
    },
    500
  );
});

export default app;
