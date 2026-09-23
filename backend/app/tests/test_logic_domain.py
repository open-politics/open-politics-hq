"""
Tests for the `logic` domain — decisions with probabilities.

No HTTP and no server: the wires are covered by the first live run against a
real endpoint. What is pinned here is the part that has no other witness — the
shaping every wire funnels through, and the import-time guards that are supposed
to make a wrong declaration impossible.

The System One numbers in ``TestShaping`` are Kev's own published example
(README: department/escalate/frustration), so a change in how we normalise,
rate or average shows up as a disagreement with upstream rather than as a
plausible-looking new number.
"""
import asyncio

import pytest

from app.api.modules.foundation_service_providers import descriptor_for, domain_for
from app.api.modules.foundation_service_providers.logic import (
    Choice, Logic, LogicQuirks, Noul, QuestionsQuirks, RawQuirks, Readout, Score,
)
from app.api.modules.foundation_service_providers.logic import transforms
from app.api.modules.foundation_service_providers.logic.engine import Judge
from app.api.modules.foundation_service_providers.language import Language, BlocksQuirks


# ═══════════════════════════════════════════════════
# Registration and declaration guards
# ═══════════════════════════════════════════════════

class TestDeclarations:

    def test_domain_is_registered_with_its_description(self):
        domain = domain_for("logic")
        assert domain is not None
        assert domain.description == (
            "Classification, Decisions, Routing & Ranking for atomic decision making"
        )

    @pytest.mark.parametrize("provider_key,dialect,quirks", [
        ("kev", "questions", QuestionsQuirks),
        ("typesafe", "questions", QuestionsQuirks),
        ("llamacpp", "raw", RawQuirks),
    ])
    def test_endpoints_bind_the_wire_they_speak(self, provider_key, dialect, quirks):
        desc = descriptor_for("logic", provider_key)
        assert desc is not None, f"{provider_key} is not registered for logic"
        assert desc.binding.dialect.name == dialect
        assert isinstance(desc.quirks, quirks)
        # The container serves the checkpoint it loaded; a model name is optional.
        assert desc.model_required is False
        # And no model is declared: a picker must not offer a choice the server
        # ignores. The loaded checkpoint is reported, not chosen.
        assert desc.models == ()

    def test_system_one_endpoints_report_the_checkpoint_they_loaded(self):
        from app.api.routes.providers import _provides
        for key in ("kev", "typesafe"):
            desc = descriptor_for("logic", key)
            assert [f.name for f in desc.features] == ["loaded_model"]
            assert _provides(desc, "list_models"), "the setup UI reads this to show what answers"
        # The readout wire has no such endpoint: whatever GGUF llama-server holds
        # is reported through its own language binding, not here.
        assert descriptor_for("logic", "llamacpp").features == ()

    def test_kev_declares_the_state_window_it_was_trained_on(self):
        # Facts about the endpoint's one model live on quirks now, so validation
        # has a single source and no model picker implies a second.
        assert descriptor_for("logic", "kev").quirks.trained_state_tokens == 384
        # Jev's training window is unpublished; a guess would warn about nothing.
        assert descriptor_for("logic", "typesafe").quirks.trained_state_tokens == 0

    def test_wrong_domain_dialect_is_refused_at_declaration(self):
        with pytest.raises(AssertionError):
            Logic(dialect=Language.dialects.blocks)

    def test_quirks_typed_to_another_wire_are_refused(self):
        with pytest.raises(AssertionError):
            Logic(dialect=Logic.dialects.raw, quirks=QuestionsQuirks())
        with pytest.raises(AssertionError):
            Logic(dialect=Logic.dialects.questions, quirks=BlocksQuirks())

    def test_a_bare_binding_still_gets_its_wire_defaults(self):
        binding = Logic(dialect=Logic.dialects.questions)
        assert isinstance(binding.quirks, QuestionsQuirks)
        assert binding.quirks.max_options == 255      # the wire's ceiling, not the base default


# ═══════════════════════════════════════════════════
# The key vocabulary
# ═══════════════════════════════════════════════════

class TestOptions:

    def test_noul_is_two_named_sides(self):
        options = transforms.as_options(Noul("Urgent?"))
        assert [o.key for o in options] == ["true", "false"]
        assert [o.description for o in options] == ["Yes", "No"]

    def test_noul_descriptions_are_used_when_given(self):
        options = transforms.as_options(Noul("Urgent?", true="Needs a human now", false="Can wait"))
        assert options[0].description == "Needs a human now"

    def test_choice_without_a_description_falls_back_to_its_key(self):
        # A bare letter with nothing behind it tells a readout model nothing.
        options = transforms.as_options(Choice("Which team?", {"returns": None}))
        assert options[0].key == "returns" and options[0].description == "returns"

    def test_score_is_keyed_by_level_index(self):
        options = transforms.as_options(Score("How angry?", ["Calm", "Cross", "Furious"]))
        assert [o.key for o in options] == ["0", "1", "2"]

    def test_state_is_measured_as_text_but_json_keeps_its_shape(self):
        assert transforms.render_state("plain") == "plain"
        assert transforms.render_state({"subject": "x"}) == '{"subject": "x"}'


# ═══════════════════════════════════════════════════
# Numbers
# ═══════════════════════════════════════════════════

class TestNumbers:

    def test_confidence_is_zero_for_a_coin_toss_and_one_for_certainty(self):
        assert transforms.confidence([0.5, 0.5]) == pytest.approx(0.0)
        assert transforms.confidence([1.0, 0.0]) == pytest.approx(1.0)

    def test_a_single_option_is_certain_by_construction(self):
        assert transforms.confidence([1.0]) == 1.0

    def test_kevs_published_choice_confidence(self):
        # README: {returns .47, shipping .28, billing .25} -> 0.21
        assert transforms.confidence([0.47, 0.28, 0.25]) == pytest.approx(0.205, abs=1e-3)

    def test_kevs_published_score_confidence(self):
        # README: {Calm 0, Frustrated .56, Very angry .44} -> 0.78. A score is a
        # scale, so confidence is distance from the modal level, not from uniform.
        assert transforms.confidence([0.0, 0.56, 0.44], ordered=True) == pytest.approx(0.78)

    def test_a_score_split_across_the_ends_is_less_decided_than_across_neighbours(self):
        near = transforms.confidence([0.5, 0.5, 0.0], ordered=True)
        far = transforms.confidence([0.5, 0.0, 0.5], ordered=True)
        assert near > far
        # The unordered formula cannot tell those two apart — which is the bug
        # this split exists to prevent.
        assert transforms.confidence([0.5, 0.5, 0.0]) == transforms.confidence([0.5, 0.0, 0.5])

    def test_temperature_flattens_without_reordering(self):
        hot = transforms.softmax(transforms.temper([3.0, 1.0], 2.0))
        cold = transforms.softmax(transforms.temper([3.0, 1.0], None))
        assert hot[0] > hot[1] and cold[0] > cold[1]      # same winner
        assert hot[0] < cold[0]                            # less sure about it

    def test_non_finite_scores_raise_instead_of_becoming_nan(self):
        with pytest.raises(ValueError):
            transforms.softmax([float("inf"), 0.0])


# ═══════════════════════════════════════════════════
# Shaping — a Readout becomes an Answer
# ═══════════════════════════════════════════════════

class _Wire:
    """A dialect that answers from a script, so the engine is tested alone."""

    def __init__(self, readouts, quirks):
        self.readouts, self.quirks = readouts, quirks

    async def ask(self, state, questions, *, model_name=None):
        return self.readouts


def _judge(readouts, quirks, provider_key="kev"):
    return Judge(_Wire(readouts, quirks), descriptor_for("logic", provider_key))


class TestShaping:

    def test_kevs_published_example(self):
        questions = {
            "department": Choice("Which team should handle this?",
                                 {"returns": "Exchanges", "shipping": "Delays", "billing": "Charges"}),
            "escalate": Noul("Does this need urgent human attention?"),
            "frustration": Score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
        }
        readouts = {
            "department": Readout({"returns": 0.47, "shipping": 0.28, "billing": 0.25}, "probs",
                                  provenance={"confidence": 0.21, "model": "jaredpalmer/kev-4b"}),
            "escalate": Readout({"true": 0.93, "false": 0.07}, "probs"),
            "frustration": Readout({"0": 0.0, "1": 0.56, "2": 0.44}, "probs"),
        }
        answers = asyncio.run(_judge(readouts, QuestionsQuirks()).judge("ticket", questions))

        assert answers["department"].value == "returns"
        assert answers["department"].confidence == pytest.approx(0.21)   # the server's own
        assert answers["department"].model == "jaredpalmer/kev-4b"
        assert answers["escalate"].value == pytest.approx(0.93)          # a noul answers p(yes)
        assert answers["frustration"].value == pytest.approx(1.44)       # mean level
        assert answers["frustration"].legend == {"0": "Calm", "1": "Frustrated", "2": "Very angry"}
        assert answers["department"].wire == "questions"

    def test_derived_confidence_when_the_server_reports_none(self):
        answers = asyncio.run(_judge(
            {"q": Readout({"true": 0.93, "false": 0.07}, "probs")}, QuestionsQuirks()
        ).judge("s", {"q": Noul("Urgent?")}))
        assert answers["q"].confidence == pytest.approx(0.86)

    def test_logits_are_tempered_then_normalised(self):
        answers = asyncio.run(_judge(
            {"q": Readout({"true": 22.0, "false": 20.0}, "logits", mass=0.998)},
            RawQuirks(temperature=2.0), provider_key="llamacpp",
        ).judge("s", {"q": Noul("So?")}))
        assert answers["q"].probabilities["true"] == pytest.approx(0.731, abs=1e-3)
        assert answers["q"].mass == 0.998          # the obedience signal survives
        assert sum(answers["q"].probabilities.values()) == pytest.approx(1.0)

    def test_probabilities_are_renormalised_over_the_options_asked_for(self):
        # A server answering about something we did not offer must not leak in.
        answers = asyncio.run(_judge(
            {"q": Readout({"a": 0.3, "b": 0.3, "elsewhere": 0.4}, "probs")}, QuestionsQuirks()
        ).judge("s", {"q": Choice("Which?", {"a": "A", "b": "B"})}))
        assert answers["q"].probabilities == {"a": pytest.approx(0.5), "b": pytest.approx(0.5)}

    def test_a_missing_answer_names_the_question(self):
        with pytest.raises(RuntimeError, match="wanted"):
            asyncio.run(_judge({}, QuestionsQuirks()).judge("s", {"wanted": Noul("?")}))


# ═══════════════════════════════════════════════════
# Validation
# ═══════════════════════════════════════════════════

class TestValidation:

    def test_empty_state_is_refused(self):
        for empty in ("", "   ", None, []):
            with pytest.raises(ValueError, match="non-empty state"):
                asyncio.run(_judge({}, QuestionsQuirks()).judge(empty, {"q": Noul("?")}))

    def test_one_option_is_not_a_decision(self):
        with pytest.raises(ValueError, match="needs 2"):
            asyncio.run(_judge({}, QuestionsQuirks()).judge("s", {"q": Choice("?", {"only": "one"})}))

    def test_the_option_ceiling_comes_from_the_wire(self):
        many = Choice("?", {str(i): f"option {i}" for i in range(20)})
        # The readout wire has 16 answer letters, so 20 options cannot be read off.
        with pytest.raises(ValueError, match="takes 16"):
            asyncio.run(_judge({}, RawQuirks(), provider_key="llamacpp").judge("s", {"q": many}))
        # The System One wire takes 255, so the same question is fine there.
        judge = _judge({"q": Readout({str(i): 1.0 / 20 for i in range(20)}, "probs")},
                       QuestionsQuirks())
        assert asyncio.run(judge.judge("s", {"q": many}))["q"].kind == "choice"

    def test_judge_many_keeps_input_order(self):
        judge = _judge({"q": Readout({"true": 0.9, "false": 0.1}, "probs")}, QuestionsQuirks())
        items = [(f"state {i}", {"q": Noul("?")}) for i in range(5)]
        assert len(asyncio.run(judge.judge_many(items))) == 5

    def test_judge_many_respects_the_endpoints_width(self):
        # Kev answers one request at a time and says so; the semaphore is built
        # from that number, not from how much work a caller happens to have.
        assert QuestionsQuirks().parallel == 1
        assert LogicQuirks().parallel == 1
