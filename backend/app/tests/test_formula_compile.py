"""Pins the Formula model + eligible_panels (the relation-shape → panel spine).

Pure-logic, no DB. The engine itself (``AnnotationQuery.relation``) is
exercised by the DB-backed suite (plan Task 6 verification). These lock the
two canonical questions and the panel-eligibility contract so deletions
can't silently regress them.
"""

from app.api.modules.annotation.formula import (
    Dimension,
    Formula,
    Measure,
    eligible_panels,
)
from app.core.filters import FieldCondition, FilterSet


def test_trace_a_docs_by_label_is_one_categorical_dimension():
    """'how many docs were labeled X' → one field dim + count →
    pie/chart/table eligible."""
    f = Formula(
        id="a",
        name="docs_by_label",
        group=[Dimension(name="label", kind="field", path="label")],
        measures=[Measure(name="n", agg="count")],
    )
    assert {"pie", "chart", "table"} <= eligible_panels(f)


def test_trace_b_three_entity_dims_plus_time_and_filter():
    """A,B meet a 3rd person in docs rated >8 in timeframe Y → the 3rd
    participant is a group DIMENSION (no edge primitive); relevance is a
    plain FilterSet; the month is a time dimension."""
    f = Formula(
        id="b",
        name="meetings",
        schema_id=42,
        filter=FilterSet(
            conditions=[FieldCondition(path="relevance", operator="gt", value=8)]
        ),
        group=[
            Dimension(name="p_a", kind="entity", path="participants[*]", entity_type="Person"),
            Dimension(name="p_b", kind="entity", path="participants[*]", entity_type="Person"),
            Dimension(name="p_c", kind="entity", path="participants[*]", entity_type="Person"),
            Dimension(name="month", kind="time", path="event_timestamp", interval="month"),
        ],
        measures=[Measure(name="n", agg="count")],
    )
    assert len(f.group) == 4
    assert f.group[3].interval == "month"
    # 3 entity dims still graph-eligible (renderer treats the first two as
    # the edge, extras as edge attributes); table is the universal fallback.
    panels = eligible_panels(f)
    assert "graph" in panels and "table" in panels


def test_two_entity_dims_enable_graph():
    f = Formula(
        id="c",
        name="pairs",
        group=[
            Dimension(name="src", kind="entity", path="a", entity_type="Org"),
            Dimension(name="dst", kind="entity", path="b", entity_type="Org"),
        ],
        measures=[Measure(name="n", agg="count")],
    )
    assert "graph" in eligible_panels(f)


def test_single_time_dim_is_chart_eligible():
    f = Formula(
        id="t",
        name="per_month",
        group=[Dimension(name="m", kind="time", path="event_timestamp", interval="month")],
        measures=[Measure(name="n", agg="count")],
    )
    assert "chart" in eligible_panels(f)


def test_geo_dimension_enables_map_without_string_sniffing():
    """Geo is an explicit Dimension kind — no field-name guessing."""
    f = Formula(
        id="g",
        name="by_place",
        group=[Dimension(name="place", kind="geo", path="location")],
        measures=[Measure(name="n", agg="count")],
    )
    assert "map" in eligible_panels(f)


def test_time_dimension_defaults_interval_to_month():
    d = Dimension(name="t", kind="time", path="event_timestamp")
    assert d.interval == "month"


def test_distribution_measure_is_table_only():
    f = Formula(
        id="d",
        name="dist",
        group=[Dimension(name="country", kind="doc", path="country")],
        measures=[Measure(name="mix", path="stance", agg="distribution")],
    )
    assert eligible_panels(f) == {"table"}


def test_non_count_measure_requires_path():
    import pytest

    with pytest.raises(ValueError):
        Measure(name="bad", agg="mean")  # no path


def test_top_measure_needs_no_path():
    m = Measure(name="ev", agg="top", top_n=5, top_by="relevance")
    assert m.path is None


def test_at_most_one_distribution_measure_per_formula():
    """Multiple distribution measures share one extra GROUP BY column —
    the second one would silently win. Reject at model time."""
    import pytest

    with pytest.raises(ValueError):
        Formula(
            id="x",
            name="two_dists",
            group=[Dimension(name="month", kind="time", path="t")],
            measures=[
                Measure(name="d1", path="a", agg="distribution"),
                Measure(name="d2", path="b", agg="distribution"),
            ],
        )


def test_order_by_field_accepts_arbitrary_column_name():
    """OrderBy is a thin contract — the engine validates the name against
    the actual relation shape at materialisation time."""
    from app.api.modules.annotation.formula import OrderBy

    f = Formula(
        id="o",
        name="ordered",
        group=[Dimension(name="month", kind="time", path="t")],
        measures=[Measure(name="n", agg="count")],
        order_by=OrderBy(column="n", direction="desc"),
    )
    assert f.order_by.column == "n"
    assert f.order_by.direction == "desc"


def test_n_entity_two_is_graph_eligible_too():
    """Two entity dims → graph (no change from the 'exactly 2' era — confirms
    the lower bound stays inclusive after the upper bound was lifted)."""
    f = Formula(
        id="g2",
        name="pair",
        group=[
            Dimension(name="a", kind="entity", path="actor", entity_type="Org"),
            Dimension(name="b", kind="entity", path="target", entity_type="Org"),
        ],
        measures=[Measure(name="n", agg="count")],
    )
    assert "graph" in eligible_panels(f)
