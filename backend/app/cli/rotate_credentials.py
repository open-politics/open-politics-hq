"""
Encryption key rotation — re-encrypt every stored credential blob under the
current primary key.

    docker compose exec backend python -m app.cli.rotate_credentials [options]

The only at-rest secret in HQ is ``User.encrypted_credentials`` (Fernet JSON of
each user's provider API keys). Rotating ``ENCRYPTION_MASTER_KEY`` without
re-encrypting it makes every user's keys silently unreadable. This command does
the re-encryption safely:

  • Phase A — decrypt EVERY non-empty blob with the full MultiFernet keyring
    (primary + fallbacks). If a single row fails, abort with ZERO writes.
  • Phase B — re-encrypt under the primary key, committed in batches. A failure
    rolls back the current batch and aborts; already-committed rows stay
    decryptable by the still-present fallback, so there is never a
    half-unreadable state. Safe to re-run (idempotent).
  • Phase C — re-verify a random sample using the PRIMARY KEY ALONE, simulating
    the post-rotation state after fallbacks are removed.

Rotation procedure (operator):

  1. Generate a new key:   python -m app.cli.rotate_credentials --generate-key
  2. In .env: move the current ENCRYPTION_MASTER_KEY value into
     ENCRYPTION_MASTER_KEY_FALLBACKS, set ENCRYPTION_MASTER_KEY to the new key.
  3. Restart backend, celery_worker, celery_beat (no shared key cache — each
     process must reload).  ./setup.sh rotate --fernet automates steps 1-5.
  4. Run this command (no flags).
  5. After it reports success, clear ENCRYPTION_MASTER_KEY_FALLBACKS and restart
     the three services again. The old key is now fully retired.

Infrastructure credentials (Postgres / MinIO / Redis) are NOT touched here —
those are recoverable and handled by ``./setup.sh rotate``.
"""

from __future__ import annotations

import argparse
import random
import sys
from typing import List, Optional

from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine


# ── helpers ──────────────────────────────────────────────────────────────────

GREEN, RED, YELLOW, DIM, NC = "\033[0;32m", "\033[0;31m", "\033[1;33m", "\033[2m", "\033[0m"


def _keyring(keys: List[str]) -> MultiFernet:
    return MultiFernet([Fernet(k.encode()) for k in keys])


def _generate_key() -> None:
    new_key = Fernet.generate_key().decode()
    print(f"\n{GREEN}New Fernet key:{NC}\n\n  {new_key}\n")
    print("Edit .env:")
    print("  ENCRYPTION_MASTER_KEY_FALLBACKS=<your current ENCRYPTION_MASTER_KEY>")
    print(f"  ENCRYPTION_MASTER_KEY={new_key}")
    print(
        "\nThen restart backend, celery_worker, celery_beat and run this command\n"
        "again with no flags to re-encrypt. (No DB was touched.)\n"
    )


def _load_target_users(session: Session):
    """Users with a non-empty stored blob, ordered by id (stable batching)."""
    from app.api.modules.identity_infospace_user.models import User

    stmt = (
        select(User.id, User.encrypted_credentials)
        .where(User.encrypted_credentials.is_not(None))
        .where(User.encrypted_credentials != "")
        .order_by(User.id)
    )
    return session.exec(stmt).all()


# ── command ──────────────────────────────────────────────────────────────────


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli.rotate_credentials",
        description="Re-encrypt all stored user credentials under the current primary key.",
        epilog=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--generate-key", action="store_true",
                        help="Print a fresh key + .env instructions and exit (no DB access).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Decrypt-check every row and report; write nothing.")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="Skip the confirmation prompt (required for non-TTY in production).")
    parser.add_argument("--batch-size", type=int, default=500,
                        help="Rows per commit (default 500).")
    parser.add_argument("--sample", type=int, default=25,
                        help="Phase C verification sample size (default 25).")
    args = parser.parse_args(argv)

    if args.generate_key:
        _generate_key()
        return 0

    keys = settings.encryption_keys
    if not keys:
        print(f"{RED}ENCRYPTION_MASTER_KEY is not set — nothing to rotate.{NC}")
        return 2

    primary = keys[0]
    full_ring = _keyring(keys)
    primary_only = _keyring([primary])

    if settings.ENVIRONMENT == "production" and not args.yes and not sys.stdin.isatty():
        print(f"{RED}Refusing to run non-interactively in production without --yes.{NC}")
        return 2

    print(f"{DIM}Keyring: 1 primary + {len(keys) - 1} fallback key(s). "
          f"Environment: {settings.ENVIRONMENT}.{NC}")

    # Register every model so the User mapper's relationships resolve
    # (same re-export hub alembic and the app use).
    import app.models  # noqa: F401

    with Session(engine) as session:
        rows = _load_target_users(session)
        total = len(rows)
        if total == 0:
            print(f"{GREEN}No stored credentials found. Nothing to do.{NC}")
            return 0

        # ── Phase A: decrypt-all safety gate (no writes) ──
        failed: List[int] = []
        for uid, blob in rows:
            try:
                full_ring.decrypt(blob.encode())
            except (InvalidToken, ValueError):
                failed.append(uid)

        if failed:
            print(f"{RED}ABORT: {len(failed)}/{total} rows cannot be decrypted with "
                  f"any configured key. Zero writes performed.{NC}")
            print(f"{RED}Affected user ids: {failed}{NC}")
            print("Add the correct old key to ENCRYPTION_MASTER_KEY_FALLBACKS and retry.")
            return 1

        print(f"{GREEN}Phase A OK:{NC} all {total} blobs decrypt with the keyring.")

        if args.dry_run:
            print(f"{YELLOW}--dry-run:{NC} {total} rows would be re-encrypted under the "
                  f"primary key. No changes made.")
            return 0

        if not args.yes:
            resp = input(f"Re-encrypt {total} credential blobs under the primary key? [y/N] ")
            if resp.strip().lower() not in ("y", "yes"):
                print("Aborted by user. No changes made.")
                return 0

        # ── Phase B: re-encrypt under primary, batched commits ──
        from app.api.modules.identity_infospace_user.models import User

        rotated = 0
        try:
            for start in range(0, total, args.batch_size):
                batch = rows[start:start + args.batch_size]
                for uid, blob in batch:
                    new_blob = full_ring.rotate(blob.encode()).decode()
                    user = session.get(User, uid)
                    if user is None:  # deleted mid-run; harmless
                        continue
                    user.encrypted_credentials = new_blob
                    session.add(user)
                session.commit()
                rotated += len(batch)
                print(f"{DIM}  committed {rotated}/{total}{NC}")
        except Exception as e:  # noqa: BLE001 — abort cleanly, prior batches valid
            session.rollback()
            print(f"{RED}ABORT during write: {e}{NC}")
            print(f"{YELLOW}{rotated} rows already re-encrypted (still decryptable by the "
                  f"old fallback key). Re-run to resume — it is idempotent.{NC}")
            return 1

        # ── Phase C: verify a sample with the PRIMARY KEY ALONE ──
        session.expire_all()
        verify_rows = _load_target_users(session)
        sample = random.sample(verify_rows, min(args.sample, len(verify_rows)))
        for uid, blob in sample:
            try:
                primary_only.decrypt(blob.encode())
            except (InvalidToken, ValueError):
                print(f"{RED}VERIFICATION FAILED for user {uid}. DO NOT remove the "
                      f"fallback key. Investigate before retrying.{NC}")
                return 1

    print(f"\n{GREEN}Done.{NC} Re-encrypted {rotated} blobs; verified "
          f"{len(sample)} with the primary key alone.")
    print(f"{YELLOW}Next:{NC} clear ENCRYPTION_MASTER_KEY_FALLBACKS in .env and restart "
          f"backend, celery_worker, celery_beat. The old key is then retired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
