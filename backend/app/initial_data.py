import logging
import time

from sqlmodel import Session

from app.core.db import engine
from app.core.seed import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init() -> None:
    time.sleep(3)
    with Session(engine) as session:
        init_db(session)


def main() -> None:
    time.sleep(3)
    logger.info("Creating initial data")
    init()
    logger.info("Initial data created")


if __name__ == "__main__":
    main()