import { Client, Users } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || '6552291c54fa3fe9cfb2')
    .setKey(req.headers['x-appwrite-key'] ?? '');
  const users = new Users(client);

  if (req.path === "/ping") {
    return res.text("Pong");
  }

  try {
    const usersList = await users.list();
    log(`Found ${usersList.total} users`);

    const results = {
      checked: 0,
      needsRefresh: 0,
      errors: 0,
      details: []
    };

    for (const user of usersList.users) {
      try {
        log(`Checking identities for user: ${user.$id}`);
        const identities = await users.listIdentities(user.$id);
        
        for (const identity of identities.identities) {
          if (identity.provider === 'oauth2') {
            try {
              const accessToken = identity.accessToken;
              if (!accessToken) {
                log(`No access token found for identity ${identity.$id}`);
                continue;
              }

              // Check if token is about to expire
              // Most OAuth tokens include an 'exp' claim in the JWT payload
              const isNearExpiry = checkTokenExpiry(accessToken);
              
              results.checked++;
              
              if (isNearExpiry) {
                log(`Token for user ${user.$id}, identity ${identity.$id} is near expiry`);
                results.needsRefresh++;
                results.details.push({
                  userId: user.$id,
                  identityId: identity.$id,
                  provider: identity.provider,
                  needsRefresh: true
                });
                
                // TODO: Refresh token logic
                // Here you would implement the token refresh mechanism
                // For example:
                // await refreshToken(user.$id, identity.$id, identity.refreshToken);
              }
            } catch (identityError) {
              error(`Error processing identity ${identity.$id}: ${identityError.message}`);
              results.errors++;
            }
          }
        }
      } catch (userError) {
        error(`Error fetching identities for user ${user.$id}: ${userError.message}`);
        results.errors++;
      }
    }

    return res.json(results);
  } catch (err) {
    error(`Failed to process users: ${err.message}`);
    return res.json({
      success: false,
      error: err.message
    }, 500);
  }
};

function checkTokenExpiry(token) {
  try {
    // Split the token to get the payload
    const parts = token.split('.');
    if (parts.length !== 3) {
      return true; // If token format is invalid, flag for refresh
    }

    // Decode the payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    
    // Check if there's an expiration time
    if (!payload.exp) {
      return false; // No expiration, assume valid
    }

    // Calculate time remaining
    const expiryTime = payload.exp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const timeRemaining = expiryTime - currentTime;
    
    // Consider tokens with less than 1 day (86400000 ms) remaining as "near expiry"
    const nearExpiryThreshold = 86400000;
    
    return timeRemaining < nearExpiryThreshold;
  } catch (error) {
    // If we can't parse the token, consider it needing refresh
    return true;
  }
}