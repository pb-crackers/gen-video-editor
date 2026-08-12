/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * There is no Supabase project behind this fork.
 *
 * The export is kept (typed `null`) rather than deleted so that any remaining
 * `if (!supabase) return` guards upstream still read naturally, and so a stray
 * import fails at the call site instead of at module load.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const supabase: SupabaseClient | null = null;
