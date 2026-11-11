"""Process-wide singletons, overridable in tests via FastAPI dependency_overrides."""

from functools import lru_cache

from .config import Settings, get_settings
from .services.chain import Chain
from .services.store import Store


@lru_cache
def get_store() -> Store:
    return Store(get_settings().database_path)


@lru_cache
def get_chain() -> Chain:
    return Chain(get_settings())


__all__ = ["Settings", "get_settings", "get_store", "get_chain"]
