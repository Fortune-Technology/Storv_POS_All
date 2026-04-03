import { getMarktPOSToken } from '../services/marktPOSService.js';
import prisma from '../config/postgres.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let refreshInterval = null;

const refreshAllTokens = async () => {
  try {
    const users = await prisma.user.findMany({
      where: { marktPOSUsername: { not: null } },
      select: { id: true, email: true, marktPOSUsername: true, marktPOSPassword: true },
    });

    console.log(`🔄 Checking MarktPOS tokens for ${users.length} user(s)...`);

    for (const user of users) {
      try {
        await getMarktPOSToken(user);
      } catch (err) {
        console.warn(`⚠ Could not refresh MarktPOS token for user ${user.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('✗ Failed to run token refresh cycle:', err.message);
  }
};

export const startTokenRefreshScheduler = () => {
  refreshAllTokens();
  refreshInterval = setInterval(refreshAllTokens, CHECK_INTERVAL_MS);
  console.log('✓ MarktPOS multi-user token refresh scheduler started (daily check)');
};

export const stopTokenRefreshScheduler = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('✓ MarktPOS token refresh scheduler stopped');
  }
};
