'use client';

import { passkeyClient } from '@better-auth/passkey/client';
import { twoFactorClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser side of Better Auth: only what needs WebAuthn. Everything else goes through server actions. */
export const authClient = createAuthClient({
  plugins: [usernameClient(), twoFactorClient(), passkeyClient()],
});
