"""What a run needs to read an asset — ``annotation/plan.py``.

The run loop, the batch retry and the single retry each built this themselves
and had drifted apart. These pin what the one build must do for all of them:
the media-mapping key the demultiplexer reads, the two-phase split, endpoint
simplification decided by the *resolved* model (a run usually pins none and
runs on the saved default), and handing ``resolve`` only what the run pins.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlmodel import Session

from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
from app.api.modules.annotation.plan import (
    MEDIA_MAPPING, SchemaUnusable, language_for, prepare,
)
from app.core.db import engine

LONG = "x" * 400


@pytest.fixture
def session():
    with Session(engine) as s:
        yield s


def _schema(contract: dict, instructions: str | None = "Read closely.") -> AnnotationSchema:
    return AnnotationSchema(id=9001, name="probe schema", output_contract=contract,
                            instructions=instructions, infospace_id=0, user_id=0)


def _run(config: dict | None = None) -> AnnotationRun:
    return AnnotationRun(id=9001, name="probe", infospace_id=0, user_id=0, configuration=config or {})


def _language(provider_key: str = "llamacpp", model: str | None = "m"):
    return SimpleNamespace(provider_key=provider_key, model=model)


def _doc(**props) -> dict:
    return {"type": "object", "properties": {"document": {"type": "object", "properties": props}}}


def test_per_media_sections_ask_for_the_key_demultiplexing_reads(session):
    """The single retry asked for ``_system_asset_source_uuid``; the run loop
    sent literal ``\\n`` characters. Nothing read the first; the model read the
    second as text."""
    contract = {
        "type": "object",
        "properties": {
            "document": {"type": "object", "properties": {"title": {"type": "string"}}},
            "per_image": {"type": "array", "items": {"type": "object", "properties": {"caption": {"type": "string"}}}},
        },
    }
    plan = prepare(session, _run(), _schema(contract), _language())
    assert plan.instructions == f"Read closely.\n\n{MEDIA_MAPPING}"
    assert "'system_asset_source_uuid'" in plan.instructions
    assert "\\n" not in plan.instructions


def test_list_fields_get_a_phase_a_model(session):
    """The single retry built no Phase A model, so it always read single-shot."""
    contract = _doc(
        title={"type": "string"},
        actors={"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}}}},
    )
    plan = prepare(session, _run(), _schema(contract), _language())
    assert [f for f in plan.list_fields], "array<object> fields go to Phase B"
    assert plan.phase_a_model is not None
    assert plan.output_model.model_fields


def test_simplification_follows_the_resolved_model_not_the_run_config(session):
    """A run that pins nothing runs on the saved default. If that default is
    Ollama the contract is simplified — the run's configuration cannot say so."""
    contract = _doc(summary={"type": "string", "description": LONG})
    on_default_ollama = prepare(session, _run({}), _schema(contract), _language("ollama", None))
    elsewhere = prepare(session, _run({}), _schema(contract), _language("llamacpp"))

    def desc(plan):
        return plan.contract["properties"]["document"]["properties"]["summary"]["description"]

    assert len(desc(on_default_ollama)) < len(LONG)
    assert desc(elsewhere) == LONG


def test_instructions_stand_in_for_the_schemas_own(session):
    plan = prepare(session, _run(), _schema(_doc(t={"type": "string"})), _language(),
                   instructions="Retry: look at the footnotes.")
    assert plan.instructions == "Retry: look at the footnotes."


@pytest.mark.parametrize("contract, why", [
    ({"document": {"type": "object"}, "summary": {"type": "string"}}, "mixes per-media sections"),
    ({"type": "string"}, "not an object schema"),
])
def test_an_unusable_schema_says_which_and_why(session, contract, why):
    with pytest.raises(SchemaUnusable, match=rf"Schema 9001 \(probe schema\) .*{why}"):
        prepare(session, _run(), _schema(contract), _language())


def test_language_for_passes_on_only_what_the_run_pins(session, monkeypatch):
    """Everything the run leaves out must reach ``resolve`` as None, so the saved
    selection for annotation fills it — the old single retry passed no model
    and no session, and no provider at all unless the run named one."""
    import app.api.modules.foundation_service_providers as fsp

    calls = []
    monkeypatch.setattr(fsp, "resolve", lambda *a, **kw: calls.append((a, kw)) or "resolved")

    assert language_for(session, _run({})) == "resolved"
    (args, kw), = calls
    assert args == ("language", None, None)
    assert kw["context"] == "annotation" and kw["runtime_key"] is None and kw["session"] is session

    calls.clear()
    language_for(session, _run({"ai_provider": "anthropic", "ai_model": "m1", "api_keys": {"anthropic": "k"}}))
    (args, kw), = calls
    assert args == ("language", "anthropic", "m1") and kw["runtime_key"] == "k"
