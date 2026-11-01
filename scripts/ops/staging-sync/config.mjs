/**
 * Fixed identities for the Production -> Staging data refresh. Nothing here is configurable at run time: the direction is one-way and the ids are pinned,
 * so a wrong flag or secret can never turn Staging into the source or Production into the target (pinned by worker/test/staging-sync.test.mjs).
 */
export const ACCOUNT_ID = "8d8d61851e9e56969b4a6bf9a985e9a4";

/** Production: READ ONLY. The clients in clients.mjs expose no write method for it. */
export const SOURCE = Object.freeze({ name: "framework-portal", id: "b213b7db-ed29-4ab6-946c-0728dd6709e8", filesBucket: "framework-portal-files" });

/** Staging: the only place anything is written. */
export const TARGET = Object.freeze({
  name: "framework-portal-staging",
  id: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8",
  filesBucket: "framework-portal-files-staging",
  backupBucket: "framework-portal-files-staging-backup",
});

if (SOURCE.id === TARGET.id || SOURCE.filesBucket === TARGET.filesBucket) throw new Error("source and target must differ");

/** Disabled stand-in for the Production user ids that a few copied columns must reference (foreign keys). It cannot sign in: status disabled, no WorkOS identity. */
export const PLACEHOLDER_USER = Object.freeze({
  id: "00000000-0000-4000-8000-0000000005c1",
  workos_user_id: "staging-sync-placeholder",
  email: "staging-sync@placeholder.invalid",
  name: "Production data copy",
});

export const MANIFEST_KEY = "staging-sync/manifest.json";
