import { Client, Account, Users, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  log('=== TOKEN REFRESHER FUNCTION STARTED ===');
  log(`Execution time: ${new Date().toISOString()}`);
  
  try {
    // Initialize Appwrite client
    log('Initializing Appwrite client');
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || '6552291c54fa3fe9cfb2';
    const apiKey = process.env.APPWRITE_API_KEY || req.headers['x-appwrite-key'] || '';

    log(`Using endpoint: ${endpoint}`);
    log(`Using project ID: ${projectId}`);
    log(`Using apiKey: ${apiKey}`);
    
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY || '');
    
    const users = new Users(client);
    const account = new Account(client);

    if (req.path === "/ping") {
      log('Ping request received, responding with Pong');
      return res.text("Pong");
    }
    
    log('Fetching user list');
    const usersList = await users.list();
    log(`Found ${usersList.total} total users`);

    log(`Users list: ${JSON.stringify(usersList)}`);


    const results = {
      checked: 0,
      needsRefresh: 0,
      errors: 0,
      details: []
    };

    // Process each user
    log('Starting to process users');
    for (const user of usersList.users) {
      log(`Processing user: ${user.$id} (${user.name || 'Unknown name'})`);
      
      try {
        log(`Fetching identities for user: ${user.$id}`);
        
        try {
          
          // Filter identities for current user
          var identities = await users.listIdentities([Query.equal('userId', [user.$id])]);
          log(`Identities : ${JSON.stringify(identities)}`);
          log(`Found ${identities?.total || 0} identities for user ${user.$id}`);
          log(`----------`)
        } catch (err) {
          log(`Error fetching identities: ${err.message}`);
          // Create an empty result to continue execution
          identities = { total: 0, identities: [] };
        }
        
        // Process each identity - only Google ones
        if (!identities || !identities.identities) {
          log(`No identities found or error occurred`);
          continue;
        }
        
        for (const identity of identities.identities) {
          log(`Processing identity: ${identity.$id}, provider: ${identity.provider}`);
          
          // Skip non-Google identities
          if (identity.provider !== 'google') {
            log(`Skipping non-Google identity: ${identity.provider}`);
            continue;
          }
          
          try {
              const accessToken = identity.providerAccessToken;
              const expiry = identity.providerAccessTokenExpiry;
              
              if (!accessToken) {
                log(`WARNING: No access token found for identity ${identity.$id}`);
                continue;
              }
              
              log(`Checking token expiry for identity ${identity.$id}`);
              
              // Safely log a portion of the token (first 10 chars)
              const tokenPreview = accessToken.substring(0, 10) + '...';
              log(`Token preview: ${tokenPreview}`);
              
              // Check expiry using our dedicated function
              const isNearExpiry = checkExpiryDate(expiry, log);
              
              log(`Token expiry check result: ${isNearExpiry ? 'NEEDS REFRESH' : 'Valid'}`);
              
              results.checked++;
              
              if (isNearExpiry) {
                log(`⚠️ TOKEN NEEDS REFRESH for user ${user.$id}, identity ${identity.$id}`);
                results.needsRefresh++;
                results.details.push({
                  userId: user.$id,
                  identityId: identity.$id,
                  provider: identity.provider,
                  expiryDate: expiry || 'Unknown',
                  needsRefresh: true
                });
                
                // TODO: Refresh token logic
                // log(`Attempting to refresh token for identity ${identity.$id}`);
                const userSessions = await users.listSessions(user.$id);
                log(`User sessions: ${JSON.stringify(userSessions)}`);

                // var sessions = userSessions.sessions || [];
                // log(`Trying to update google session for user ${user.$id}`);
                // for (const session of sessions) {
                //   log(`Session ID: ${session.$id}, provider: ${session.provider}`);
                //   if (session.provider === 'google') {
                //     log(`Refreshing token for session ${session.$id}`);
                //     const res = await account.updateSession(session.$id);
                //     log(`Response: ${JSON.stringify(res)}`);
                //   }
                // }
                // await refreshToken(user.$id, identity.$id, identity.refreshToken);
              }
            } catch (identityError) {
              const errorMsg = `Error processing identity ${identity.$id}: ${identityError.message}`;
              error(errorMsg);
              log(`ERROR: ${errorMsg}`);
              results.errors++;
            }
        }
      } catch (userError) {
        const errorMsg = `Error fetching identities for user ${user.$id}: ${userError.message}`;
        error(errorMsg);
        log(`ERROR: ${errorMsg}`);
        results.errors++;
      }
    }

    // Summarize results
    log('=== TOKEN REFRESHER SUMMARY ===');
    log(`Total tokens checked: ${results.checked}`);
    log(`Tokens needing refresh: ${results.needsRefresh}`);
    log(`Errors encountered: ${results.errors}`);
    log(`Detailed results: ${JSON.stringify(results.details)}`);
    log('=== TOKEN REFRESHER COMPLETED ===');

    return res.json(results);
  } catch (err) {
    const errorMsg = `Failed to process users: ${err.message}`;
    error(errorMsg);
    log(`CRITICAL ERROR: ${errorMsg}`);
    log('=== TOKEN REFRESHER FAILED ===');
    
    return res.json({
      success: false,
      error: err.message
    }, 500);
  }
};

// Check if a token is near expiry based on its expiry date
function checkExpiryDate(expiryDateString, logFunction) {
  const log = logFunction || console.log;
  
  try {
    // If no expiry date is provided, consider it as needing refresh
    if (!expiryDateString) {
      log('No expiry date provided');
      return true;
    }
    
    // Parse the expiry date
    const expiryDate = new Date(expiryDateString);
    const currentTime = Date.now();
    const timeRemaining = expiryDate.getTime() - currentTime;
    
    // Consider tokens with less than 1 day (86400000 ms) remaining as "near expiry"
    const nearExpiryThreshold = 86400000;
    const daysRemaining = Math.floor(timeRemaining / 86400000);
    
    log(`Token expires at: ${expiryDate.toISOString()}, ${daysRemaining} days remaining`);
    
    // Token is near expiry if less than threshold time remains
    return timeRemaining < nearExpiryThreshold;
  } catch (error) {
    log(`Error parsing expiry date: ${error.message}`);
    // If we can't parse the date, consider it needing refresh
    return true;
  }
}