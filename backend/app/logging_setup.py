import logging


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    for noisy in ("rasterio", "rasterio.session", "urllib3", "httpx", "apscheduler.executors"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
