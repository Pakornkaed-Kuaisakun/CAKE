// src/modules/calendar/auth.ts
//
// OAuth flow — local callback server (replaces deprecated OOB flow)

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import http from "http";
import url from "url";
import fs from "fs";
import { exec } from "child_process";
import { env } from "../../config/env.js";
import { TOKEN_FILE, GOOGLE_SCOPES, CAKE_DIR } from "../../config/constants.js";

const REDIRECT_URI = "http://localhost:3000/callback";
const PORT = 3000;

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    REDIRECT_URI,
  );
}

/** Opens a URL in the default browser cross-platform */
function openBrowser(authUrl: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${authUrl}"`
      : platform === "darwin"
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(cmd, (err) => {
    if (err)
      console.error(
        "[auth] Could not open browser automatically:",
        err.message,
      );
  });
}

/**
 * Starts a temporary local HTTP server, opens the browser, waits for Google
 * to redirect back with the auth code, saves the token, then shuts down.
 * Returns a status message string.
 */
export async function runAuthFlow(): Promise<string> {
  const client = makeOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent", // ensures refresh_token is always returned
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Ignore favicon requests
      if (!req.url || req.url === "/favicon.ico") {
        res.end();
        return;
      }

      const parsed = url.parse(req.url, true);
      const code = parsed.query.code as string | undefined;
      const error = parsed.query.error as string | undefined;

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Auth failed: ${error}</h2><p>You can close this tab.</p></body></html>`,
        );
        server.close();
        reject(new Error(`Google auth denied: ${error}`));
        return;
      }

      if (!code) {
        res.end("Waiting...");
        return;
      }

      try {
        // Exchange code for tokens
        const { tokens } = await client.getToken(code);

        // Preserve existing refresh_token if the new response doesn't include one
        if (!tokens.refresh_token && fs.existsSync(TOKEN_FILE)) {
          const existing = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
          tokens.refresh_token = existing.refresh_token;
        }

        fs.mkdirSync(CAKE_DIR, { recursive: true });
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family:sans-serif;padding:2rem;text-align:center">
            <h2>CAKE is connected to Google Calendar!</h2>
            <p>You can close this tab and return to the terminal.</p>
          </body></html>
        `);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Token exchange failed</h2><pre>${err}</pre></body></html>`,
        );
        server.close();
        reject(err);
        return;
      }

      server.close();
      resolve("✅ Google Calendar authenticated successfully!");
    });

    server.listen(PORT, "localhost", () => {
      console.log(
        `[auth] Listening on http://localhost:${PORT} — opening browser…`,
      );
      openBrowser(authUrl);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${PORT} is already in use.\n` +
              `Stop whatever is running on port ${PORT} and try again.\n` +
              `Or run: lsof -ti:${PORT} | xargs kill`,
          ),
        );
      } else {
        reject(err);
      }
    });

    // Safety timeout — 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(
          new Error(
            "Auth timed out after 5 minutes. Run /calendar auth to try again.",
          ),
        );
      },
      5 * 60 * 1000,
    );
  });
}

export function getAuthorizedClient(): OAuth2Client {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error("Google Calendar not authenticated. Run: /calendar auth");
  }
  const client = makeOAuthClient();
  const credentials = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  client.setCredentials(credentials);

  // Auto-save refreshed tokens
  client.on("tokens", (refreshed) => {
    const merged = { ...credentials, ...refreshed };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2));
  });

  return client;
}
