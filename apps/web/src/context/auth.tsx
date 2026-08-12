/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local-only auth.
 *
 * This fork has no accounts, no sign-in and no metered credits: the editor runs
 * entirely on the user's machine. The upstream `AuthContextValue` shape is kept
 * verbatim so the ~20 components that read it keep compiling — every field is
 * answered locally instead of from Supabase.
 *
 * Headless mode is real and is preserved: `dapi open -b` drives it over the main
 * bridge, and the shell reads it to decide whether to draw UI.
 */
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';
import type { Session, User } from '@supabase/supabase-js';

import { mainBridge } from '@/lib/ipc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from '@/utils';

type OAuthProvider = 'google' | 'apple' | 'github';

type AuthContextValue = {
  session: Accessor<Session | null>;
  user: Accessor<User | null>;
  isAuthenticated: Accessor<boolean>;
  headless: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  accessLevel: Accessor<number>;
  remainingCredits: Accessor<number>;
  creditLimit: Accessor<number>;
  nextCreditReset: Accessor<Date | null>;
  isPro: Accessor<boolean>;
  hasStripeCustomer: Accessor<boolean>;
  productUpdatesEnabled: Accessor<boolean>;
  marketingAnnouncementsEnabled: Accessor<boolean>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>();

/**
 * The stand-in identity. Nothing is sent anywhere; this exists so components
 * that render a name or an avatar have something to render.
 */
const LOCAL_USER = {
  id: 'local',
  aud: 'local',
  role: 'local',
  email: 'local@localhost',
  app_metadata: { provider: 'local', providers: ['local'] },
  user_metadata: { email: 'local@localhost', name: 'Local' },
  created_at: new Date(0).toISOString(),
} as unknown as User;

/** Access level 2+ means "not the free tier" upstream; locally everything is on. */
const LOCAL_ACCESS_LEVEL = 2;

export function AuthProvider(props: { children: JSX.Element }) {
  const [headless, setHeadless] = createSignal(false);

  onMount(() => {
    if (!window.desktop) return;

    mainBridge
      .call(MAIN_CHANNELS.HEADLESS_GET_MODE, undefined)
      .then(setHeadless);

    const unsubscribe = mainBridge.handle(
      MAIN_CHANNELS.HEADLESS_MODE,
      ({ active }) => setHeadless(active),
    );
    onCleanup(unsubscribe);
  });

  const noop = async () => {};

  const ctx: AuthContextValue = {
    session: () => null,
    user: () => LOCAL_USER,
    isAuthenticated: () => true,
    headless,
    isLoading: () => false,
    accessLevel: () => LOCAL_ACCESS_LEVEL,
    // Credits are a hosted-billing concept. Locally there is no meter, and
    // Infinity would format badly in the UI that still reads these.
    remainingCredits: () => Number.MAX_SAFE_INTEGER,
    creditLimit: () => Number.MAX_SAFE_INTEGER,
    nextCreditReset: () => null,
    isPro: () => true,
    hasStripeCustomer: () => false,
    productUpdatesEnabled: () => false,
    marketingAnnouncementsEnabled: () => false,
    signInWithOAuth: noop,
    signInWithOtp: async () => ({ error: null }),
    signOut: noop,
    deleteAccount: async () => ({ error: 'Accounts do not exist in this build.' }),
    refreshSession: noop,
  };

  return (
    <AuthContext.Provider value={ctx}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  assert(ctx, 'useAuth must be used within AuthProvider');
  return ctx;
}
