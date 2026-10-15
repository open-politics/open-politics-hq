"""Recent — a bounded, least-recently-used map for per-process read caches.

For results keyed by everything that determines them — a run's watermark among
it — so an entry can never be stale, only evicted. The overview and network
streams keep their last readings this way: reopening a panel on a run that has
not changed costs nothing.
"""
from __future__ import annotations

from collections import OrderedDict
from collections.abc import Hashable


class Recent[V]:
    def __init__(self, size: int) -> None:
        self.size = size
        self._items: OrderedDict[Hashable, V] = OrderedDict()

    def get(self, key: Hashable) -> V | None:
        hit = self._items.get(key)
        if hit is not None:
            self._items.move_to_end(key)
        return hit

    def put(self, key: Hashable, value: V) -> None:
        self._items[key] = value
        self._items.move_to_end(key)
        while len(self._items) > self.size:
            self._items.popitem(last=False)
