"""
Update the live superuser's email and/or password.

The .env ``FIRST_SUPERUSER`` / ``FIRST_SUPERUSER_PASSWORD`` are SEED values used
only on the first backend init to create the user. After that, editing .env
alone has no effect on the live account — this command does the DB update.

    docker compose exec backend python -m app.cli.set_superuser [options]

Options:
    --identify EMAIL    look up the user by this email (default: FIRST_SUPERUSER
                        from settings; pass the OLD email when rotating to new)
    --email NEW_EMAIL   change the user's email
    --password NEW_PASS change the user's password

Exit codes: 0 ok, 2 user-not-found, 3 not a superuser, other → bad usage.
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.core.security import get_password_hash


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="python -m app.cli.set_superuser",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--identify")
    p.add_argument("--email")
    p.add_argument("--password")
    a = p.parse_args(argv)
    if not (a.email or a.password):
        p.error("specify --email and/or --password")

    import app.models  # register all model mappers
    from app.api.modules.identity_infospace_user.models import User

    target = a.identify or settings.FIRST_SUPERUSER
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == target)).first()
        if user is None:
            print(f"No user with email '{target}'.", file=sys.stderr)
            return 2
        if not getattr(user, "is_superuser", False):
            print(f"User '{target}' is not a superuser. Refusing.", file=sys.stderr)
            return 3
        if a.email:
            user.email = a.email
        if a.password:
            user.hashed_password = get_password_hash(a.password)
        session.add(user)
        session.commit()
        print(f"Superuser updated: email={user.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
