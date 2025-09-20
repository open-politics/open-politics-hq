#!/bin/bash
set -e

#
cp hq-kubernetes-chart/values.example.yaml hq-kubernetes-chart/values.yaml
cp .tfvars.example .tfvars

echo "✅ Initialization complete. Config files moved. Please look at:
- hq-kubernetes-chart/values.yaml
- .tfvars

And fill them out.

Then run:
./deploy.sh

