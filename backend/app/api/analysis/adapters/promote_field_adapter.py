from typing import Dict, Any
from sqlmodel import select
from app.api.analysis.adapters.base import AnalysisAdapterProtocol
from app.models import Annotation, Asset


class PromoteFieldAdapter(AnalysisAdapterProtocol):
    async def execute(self) -> Dict[str, Any]:
        source_field = self.config["source_field"]
        target_field = self.config["target_field"]
        run_id = self.config["run_id"]

        annotations = self.session.exec(select(Annotation).where(Annotation.run_id == run_id)).all()

        updated_assets = 0
        for ann in annotations:
            if source_field in ann.value:
                asset = self.session.get(Asset, ann.asset_id)
                if asset and hasattr(asset, target_field):
                    setattr(asset, target_field, ann.value[source_field])
                    self.session.add(asset)
                    updated_assets += 1

        self.session.commit()
        return {
            "updated_assets": updated_assets,
            "source_field": source_field,
            "target_field": target_field,
        }


