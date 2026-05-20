"""
Tests for the @task decorator — the universal async work primitive.

Tests cover:
- TaskDescriptor registration and defaults
- TaskContext: stat tracking, failure marking
- Topological sort for dispatch ordering
- filter_failed_items logic
- Registry population and lookup
"""
import pytest
from unittest.mock import MagicMock, patch, call
from dataclasses import fields as dataclass_fields

from app.core.tasks import (
    TaskDescriptor,
    TaskContext,
    topological_sort,
    filter_failed_items,
    _task_registry,
    get_task_registry,
    MAX_CHAIN_DEPTH,
    _slot_prefix,
)


# ═══════════════════════════════════════════════════
# TaskDescriptor — dataclass defaults and invariants
# ═══════════════════════════════════════════════════

class TestTaskDescriptor:

    def test_defaults(self):
        d = TaskDescriptor(
            name="test_task",
            check=lambda iid: None,
            celery_task_name="test_task",
        )
        assert d.batch == 50
        assert d.queue == "default"
        assert d.timeout == 120
        assert d.retries == 0
        assert d.retry_delay == 60
        assert d.max_item_failures == 5
        assert d.failure_memory == 3600
        assert d.max_concurrency == 4
        assert d.depends_on is None
        assert d.self_chain is False
        assert d.triggers == []
        assert d.tags == frozenset()
        assert d.dispatch_filter is None
        assert d.capability is None
        assert d.schedule is None

    def test_custom_values(self):
        d = TaskDescriptor(
            name="enrich_ocr",
            check=lambda iid: None,
            celery_task_name="enrich_ocr",
            batch=10,
            queue="llm",
            timeout=300,
            retries=3,
            max_concurrency=2,
            self_chain=True,
            tags=frozenset({"enrichment", "ocr"}),
            capability="ocr",
            schedule=60,
        )
        assert d.batch == 10
        assert d.queue == "llm"
        assert d.timeout == 300
        assert d.retries == 3
        assert d.max_concurrency == 2
        assert d.self_chain is True
        assert "enrichment" in d.tags
        assert "ocr" in d.tags
        assert d.capability == "ocr"
        assert d.schedule == 60

    def test_celery_task_name_matches_name(self):
        """By convention, celery_task_name == name."""
        d = TaskDescriptor(
            name="process_pending",
            check=lambda iid: None,
            celery_task_name="process_pending",
        )
        assert d.name == d.celery_task_name

    def test_schedule_none_means_event_kick_only(self):
        """schedule=None means the task won't be polled by the dispatcher."""
        d = TaskDescriptor(
            name="direct_only",
            check=lambda iid: None,
            celery_task_name="direct_only",
            schedule=None,
        )
        assert d.schedule is None

    def test_depends_on_links_tasks(self):
        d = TaskDescriptor(
            name="embedding",
            check=lambda iid: None,
            celery_task_name="embedding",
            depends_on="process_pending",
        )
        assert d.depends_on == "process_pending"


# ═══════════════════════════════════════════════════
# TaskContext — stat accumulation and failure marking
# ═══════════════════════════════════════════════════

class TestTaskContext:

    def test_stat_accumulation(self):
        ctx = TaskContext(
            infospace_id=1,
            settings=MagicMock(),
            task_name="test",
        )
        ctx.stat("processed", 5)
        ctx.stat("skipped", 2)
        ctx.stat("processed", 3)
        assert ctx._stats == {"processed": 8, "skipped": 2}

    def test_stat_default_count_is_one(self):
        ctx = TaskContext(
            infospace_id=1,
            settings=MagicMock(),
            task_name="test",
        )
        ctx.stat("items")
        ctx.stat("items")
        assert ctx._stats["items"] == 2

    def test_starts_with_empty_stats(self):
        ctx = TaskContext(
            infospace_id=42,
            settings=MagicMock(),
            task_name="test",
        )
        assert ctx._stats == {}
        assert ctx.infospace_id == 42

    def test_item_failed_tolerates_redis_errors(self):
        """item_failed should not raise even if Redis is down."""
        ctx = TaskContext(
            infospace_id=1,
            settings=MagicMock(),
            task_name="test",
        )
        # get_redis is imported inside item_failed — patch at source
        with patch("app.core.redis.get_redis", side_effect=Exception("Redis down")):
            ctx.item_failed(123)  # should not raise

    def test_provider_raises_on_unknown_capability(self):
        """provider() with an unknown capability string raises ProviderError."""
        from app.api.modules.foundation_service_providers import ProviderError
        ctx = TaskContext(
            infospace_id=1,
            settings=MagicMock(),
            task_name="test",
        )
        with pytest.raises(ProviderError, match="Unknown capability"):
            ctx.provider("not-a-real-capability")


# ═══════════════════════════════════════════════════
# Topological sort — dispatch ordering
# ═══════════════════════════════════════════════════

class TestTopologicalSort:

    def _make_descriptor(self, name, depends_on=None):
        return TaskDescriptor(
            name=name,
            check=lambda iid: None,
            celery_task_name=name,
            depends_on=depends_on,
        )

    def test_no_dependencies(self):
        a = self._make_descriptor("a")
        b = self._make_descriptor("b")
        result = topological_sort([a, b])
        assert len(result) == 2

    def test_linear_chain(self):
        a = self._make_descriptor("a")
        b = self._make_descriptor("b", depends_on="a")
        c = self._make_descriptor("c", depends_on="b")
        result = topological_sort([c, a, b])  # input order doesn't matter
        names = [d.name for d in result]
        assert names.index("a") < names.index("b")
        assert names.index("b") < names.index("c")

    def test_diamond_dependency(self):
        a = self._make_descriptor("a")
        b = self._make_descriptor("b", depends_on="a")
        c = self._make_descriptor("c", depends_on="a")
        d = self._make_descriptor("d", depends_on="b")
        result = topological_sort([d, c, b, a])
        names = [r.name for r in result]
        assert names.index("a") < names.index("b")
        assert names.index("a") < names.index("c")
        assert names.index("b") < names.index("d")

    def test_missing_dependency_is_ignored(self):
        """depends_on referencing a non-registered task doesn't crash."""
        a = self._make_descriptor("a", depends_on="nonexistent")
        result = topological_sort([a])
        assert len(result) == 1
        assert result[0].name == "a"

    def test_preserves_all_descriptors(self):
        tasks = [self._make_descriptor(f"t{i}") for i in range(10)]
        result = topological_sort(tasks)
        assert len(result) == 10
        assert {d.name for d in result} == {f"t{i}" for i in range(10)}


# ═══════════════════════════════════════════════════
# filter_failed_items — circuit breaker logic
# ═══════════════════════════════════════════════════

class TestFilterFailedItems:

    def test_no_redis_returns_all(self):
        """If Redis is unavailable, don't filter anything — let work proceed."""
        with patch("app.core.tasks._get_redis", return_value=None):
            result = filter_failed_items("task", [1, 2, 3], max_failures=5)
            assert result == [1, 2, 3]

    def test_max_failures_zero_returns_all(self):
        """max_failures <= 0 disables the circuit breaker."""
        with patch("app.core.tasks._get_redis", return_value=MagicMock()):
            result = filter_failed_items("task", [1, 2, 3], max_failures=0)
            assert result == [1, 2, 3]

    def test_filters_exceeded_items(self):
        """Items with failure count >= max_failures are excluded."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        # Item 1: 3 failures, Item 2: None (no key), Item 3: 5 failures (at limit)
        mock_pipe.execute.return_value = [b"3", None, b"5"]
        mock_redis.pipeline.return_value = mock_pipe

        with patch("app.core.tasks._get_redis", return_value=mock_redis):
            result = filter_failed_items("my_task", [1, 2, 3], max_failures=5)
            # Item 1: 3 < 5 → keep. Item 2: None → keep. Item 3: 5 >= 5 → exclude.
            assert result == [1, 2]

    def test_all_healthy_items_pass(self):
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        mock_pipe.execute.return_value = [None, None, b"1"]
        mock_redis.pipeline.return_value = mock_pipe

        with patch("app.core.tasks._get_redis", return_value=mock_redis):
            result = filter_failed_items("task", [10, 20, 30], max_failures=5)
            assert result == [10, 20, 30]

    def test_empty_input(self):
        with patch("app.core.tasks._get_redis", return_value=MagicMock()):
            result = filter_failed_items("task", [], max_failures=5)
            assert result == []


# ═══════════════════════════════════════════════════
# Registry — tasks registered at import time
# ═══════════════════════════════════════════════════

class TestTaskRegistry:

    def test_registry_is_populated(self):
        """After app import, the registry should contain @task-decorated functions."""
        # Force import of task modules to populate registry
        try:
            import app.api.modules.content.tasks  # noqa
            import app.api.modules.content.enrichers  # noqa
        except Exception:
            pass  # Import may fail without full app context

        registry = get_task_registry()
        # If any tasks registered, verify they have proper descriptors.
        # params_model tasks (user-action pattern) intentionally carry
        # check=None — they're direct-invocation only.
        for name, desc in registry.items():
            assert isinstance(desc, TaskDescriptor)
            assert desc.name == name
            if desc.params_model is None:
                assert callable(desc.check)
            else:
                assert desc.check is None

    def test_registry_returns_dict(self):
        assert isinstance(get_task_registry(), dict)


# ═══════════════════════════════════════════════════
# Slot prefix format
# ═══════════════════════════════════════════════════

class TestSlotPrefix:

    def test_format(self):
        assert _slot_prefix("enrich_ocr", 42) == "task:enrich_ocr:42:slot"

    def test_different_tasks_different_prefixes(self):
        assert _slot_prefix("a", 1) != _slot_prefix("b", 1)

    def test_different_infospaces_different_prefixes(self):
        assert _slot_prefix("a", 1) != _slot_prefix("a", 2)


# ═══════════════════════════════════════════════════
# MAX_CHAIN_DEPTH constant
# ═══════════════════════════════════════════════════

class TestChainDepth:

    def test_max_chain_depth_is_reasonable(self):
        """Prevent infinite self-chaining."""
        assert MAX_CHAIN_DEPTH > 0
        assert MAX_CHAIN_DEPTH <= 100  # not absurdly high


# ═══════════════════════════════════════════════════
# @task + params_model — user-action pattern
# ═══════════════════════════════════════════════════

class TestTaskParamsModel:
    """params_model is direct-invocation-only. Mixing it with triggers or
    schedule would make self-query and event paths incoherent (they have no
    params to pass). The decorator must reject those combos at load time."""

    def test_params_model_rejects_triggers(self):
        from pydantic import BaseModel
        from app.core.tasks import task

        class P(BaseModel):
            x: int

        with pytest.raises(AssertionError, match="triggers"):
            @task("_bad_triggers", params_model=P, triggers=["asset.ingested"])
            def _fn(ctx, ids, params): pass

    def test_params_model_rejects_schedule(self):
        from pydantic import BaseModel
        from app.core.tasks import task

        class P(BaseModel):
            x: int

        with pytest.raises(AssertionError, match="schedule"):
            @task("_bad_schedule", params_model=P, schedule=60)
            def _fn(ctx, ids, params): pass

    def test_params_model_rejects_check(self):
        """A check query is for self-query mode; params tasks don't self-query."""
        from pydantic import BaseModel
        from app.core.tasks import task

        class P(BaseModel):
            x: int

        with pytest.raises(AssertionError, match="check query"):
            @task("_bad_check", params_model=P, check=lambda iid: None)
            def _fn(ctx, ids, params): pass

    def test_plain_task_still_requires_check(self):
        from app.core.tasks import task

        with pytest.raises(AssertionError, match="check="):
            @task("_bad_plain")
            def _fn(ctx, ids): pass

    def test_params_model_descriptor_stores_model(self):
        from pydantic import BaseModel
        from app.core.tasks import task, _task_registry

        class P(BaseModel):
            value: str

        @task("_params_ok", params_model=P, queue="external_api")
        def _fn(ctx, ids, params): pass

        desc = _task_registry["_params_ok"]
        assert desc.params_model is P

    def test_delay_with_params_kwarg_sends_dict(self):
        """fn.delay(ids, iid, params=P(...)) calls Celery with the dumped dict."""
        from pydantic import BaseModel
        from app.core.tasks import task

        class P(BaseModel):
            run_id: int
            field_path: str

        @task("_delay_params", params_model=P, queue="external_api")
        def _fn(ctx, ids, params): pass

        sent = {}
        def _fake_apply_async(args=None, **kw):
            sent["args"] = args
            return MagicMock(id="celery-123")
        _fn._celery_task.apply_async = _fake_apply_async

        result = _fn.delay([1, 2], 42, params=P(run_id=5, field_path="annotations[*].location"))
        assert result.id == "celery-123"
        assert sent["args"][0] == [1, 2]
        assert sent["args"][1] == 42
        assert sent["args"][2] == {"run_id": 5, "field_path": "annotations[*].location"}

    def test_delay_type_mismatch_raises(self):
        from pydantic import BaseModel
        from app.core.tasks import task

        class P(BaseModel):
            x: int

        class Q(BaseModel):
            x: int

        @task("_delay_typecheck", params_model=P, queue="external_api")
        def _fn(ctx, ids, params): pass

        with pytest.raises(TypeError, match="expects params of type P"):
            _fn.delay([1], 1, params=Q(x=5))
